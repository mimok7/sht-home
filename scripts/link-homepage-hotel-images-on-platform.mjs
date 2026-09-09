import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupRoot = path.resolve(process.argv[2] || path.join(root, 'recovered-homepage-images'));
const BUCKET = 'homepage-images';

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

async function all(query, label) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function publicUrl(origin, storagePath) {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${origin}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
}

async function main() {
  const env = await envFile(path.join(root, '.env.local'));
  const origin = String(env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
  const database = createClient(origin, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [sourceRecords, products, currentImages] = await Promise.all([
    all((from, to) => database.from('platform_source_records').select('source_id,payload').eq('source', 'sht-platform').eq('source_table', 'homepage_hotel_images').range(from, to), '호텔 이미지 원본 조회 실패'),
    all((from, to) => database.from('catalog_products_v2').select('id,source_key,name_ko,image_url,manual_override').eq('source', 'sht-platform').eq('service_type', 'hotel').range(from, to), '호텔 상품 조회 실패'),
    all((from, to) => database.from('hotel_gallery_images_v2').select('*').range(from, to), '기존 호텔 갤러리 조회 실패'),
  ]);
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.writeFile(path.join(backupRoot, 'platform-hotel-gallery-before-link.json'), JSON.stringify({ generatedAt: new Date().toISOString(), currentImages, products }, null, 2));

  const productByCode = new Map(products.map((product) => [String(product.source_key), product]));
  const now = new Date().toISOString();
  const rows = sourceRecords.map((record) => {
    const image = record.payload || {};
    const product = productByCode.get(String(image.hotel_code || ''));
    const storagePath = text(image.storage_path);
    if (!product || !storagePath) return null;
    return {
      id: text(image.id) || String(record.source_id),
      product_id: product.id,
      hotel_price_code: text(image.hotel_price_code),
      collection: text(image.collection) || 'hotel_import',
      source_url: text(image.source_url),
      source_image_url: text(image.source_image_url),
      image_name: text(image.image_name),
      image_url: publicUrl(origin, storagePath),
      storage_bucket: BUCKET,
      storage_path: storagePath,
      sort_order: Number(image.sort_order) || 0,
      is_primary: Boolean(image.is_primary),
      updated_at: now,
    };
  }).filter(Boolean);

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await database.from('hotel_gallery_images_v2').upsert(rows.slice(index, index + 200), { onConflict: 'id' });
    if (error) throw new Error(`호텔 갤러리 저장 실패: ${error.message}`);
  }

  let heroImages = 0;
  for (const product of products) {
    const candidates = rows.filter((row) => row.product_id === product.id && !row.hotel_price_code)
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
    if (!candidates.length) continue;
    const { error } = await database.from('catalog_products_v2').update({ image_url: candidates[0].image_url, updated_at: now }).eq('id', product.id);
    if (error) throw new Error(`호텔 대표 이미지 저장 실패 (${product.name_ko}): ${error.message}`);
    heroImages += 1;
  }

  const linked = await all((from, to) => database.from('hotel_gallery_images_v2').select('id,product_id,image_url,storage_bucket,storage_path').in('id', rows.map((row) => row.id)).range(from, to), '연결 결과 검증 실패');
  const summary = { generatedAt: now, sourceImages: sourceRecords.length, linkedImages: linked.length, unmatchedImages: sourceRecords.length - rows.length, heroImages };
  await fs.writeFile(path.join(backupRoot, 'platform-hotel-gallery-link-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (linked.length !== rows.length) process.exitCode = 1;
}

await main();
