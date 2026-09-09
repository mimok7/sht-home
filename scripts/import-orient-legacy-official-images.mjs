import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const cruiseSlug = 'platform-0f54d21dc3f6';
const officialPage = 'https://orientlegacycruise.com/for-cruise';
const bucket = 'homepage-images';
const backupDirectory = path.resolve('C:/SHT-DATA/backup/homepage-images-recovery-20260909');

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

function stableId(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function extension(url, contentType) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(jpe?g|png|webp)$/i);
  if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

function publicUrl(baseUrl, storagePath) {
  return `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function sourceImages(html) {
  const matches = [...html.matchAll(/(?:src|data-src|data-lazy-src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)];
  const urls = matches.map((match) => new URL(match[1], officialPage).href)
    .filter((url) => /^https:\/\/bizweb\.dktcdn\.net\/(?:thumb\/[^/]+\/)?100\/548\/575\//i.test(url))
    .filter((url) => !/(?:logo|favicon|loading|icon|close|sprite)/i.test(new URL(url).pathname));
  return [...new Set(urls)].sort((left, right) => {
    const hero = (url) => /img_banner_cruise/i.test(url) ? 0 : /image_cruise1_1_cruise(?:\.|\?)/i.test(url) ? 1 : 2;
    return hero(left) - hero(right) || left.localeCompare(right, undefined, { numeric: true });
  });
}

async function upsertBatches(client, table, rows, onConflict, size = 200) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + size), { onConflict });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

const env = await envFile(path.join(root, '.env.local'));
const platformUrl = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const serviceKey = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
if (!platformUrl || !serviceKey) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
const database = createClient(platformUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [{ data: cruise, error: cruiseError }, pageResponse] = await Promise.all([
  database.from('cruises_v2').select('id,slug,legacy_name,name_ko,hero_image').eq('slug', cruiseSlug).eq('is_active', true).single(),
  fetch(officialPage, { headers: { 'User-Agent': 'StayHalong image migration/1.0' } }),
]);
if (cruiseError || !cruise) throw new Error(`대상 크루즈 조회 실패: ${cruiseError?.message || cruiseSlug}`);
if (!pageResponse.ok) throw new Error(`공식 페이지 조회 실패: HTTP ${pageResponse.status}`);
const urls = sourceImages(await pageResponse.text());
if (!urls.length) throw new Error('공식 페이지에서 이미지 URL을 찾지 못했습니다.');

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', cruise: cruise.name_ko, officialPage, images: urls.length, heroSource: urls[0], sample: urls.slice(0, 10) }, null, 2));
  process.exit(0);
}

await fs.mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const manifestFile = path.join(backupDirectory, `orient-legacy-official-images-${stamp}.json`);
const uploaded = [];

for (let index = 0; index < urls.length; index += 1) {
  const sourceUrl = urls[index];
  const response = await fetch(sourceUrl, { headers: { Referer: officialPage, 'User-Agent': 'StayHalong image migration/1.0' } });
  if (!response.ok) throw new Error(`공식 이미지 다운로드 실패 (${response.status}): ${sourceUrl}`);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error(`이미지가 아닌 응답: ${sourceUrl}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const ext = extension(sourceUrl, contentType);
  const imageName = index === 0 ? `main-001.${ext}` : `other-${String(index).padStart(3, '0')}.${ext}`;
  const storagePath = `cruises/${cruise.id}/official/${imageName}`;
  const { error: uploadError } = await database.storage.from(bucket).upload(storagePath, data, {
    contentType: contentType.split(';')[0],
    cacheControl: '31536000',
    upsert: true,
  });
  if (uploadError) throw new Error(`플랫폼 Storage 업로드 실패 (${imageName}): ${uploadError.message}`);
  uploaded.push({
    id: stableId(`${cruise.id}\u0000${sourceUrl}`),
    sourceUrl,
    imageName,
    storagePath,
    contentType: contentType.split(';')[0],
    bytes: data.byteLength,
    imageUrl: publicUrl(platformUrl, storagePath),
    sortOrder: index,
    isPrimary: index === 0,
  });
}

await fs.writeFile(manifestFile, JSON.stringify({ generatedAt: new Date().toISOString(), officialPage, cruise, uploaded }, null, 2));
const now = new Date().toISOString();
await upsertBatches(database, 'homepage_cruise_images', uploaded.map((image) => ({
  id: image.id,
  collection: 'cafe_import',
  cruise_name: cruise.legacy_name || cruise.name_ko,
  room_name: null,
  source_url: officialPage,
  source_image_url: image.sourceUrl,
  image_name: image.imageName,
  image_url: image.imageUrl,
  storage_bucket: bucket,
  storage_path: image.storagePath,
  sort_order: image.sortOrder,
  is_primary: image.isPrimary,
  updated_at: now,
})), 'id');
await upsertBatches(database, 'cruise_cafe_import_images_v2', uploaded.map((image) => ({
  id: image.id,
  cruise_id: cruise.id,
  cabin_id: null,
  source_url: officialPage,
  source_image_url: image.sourceUrl,
  image_name: image.imageName,
  storage_bucket: bucket,
  storage_path: image.storagePath,
  sort_order: image.sortOrder,
  is_primary: image.isPrimary,
})), 'id');
const { error: heroError } = await database.from('cruises_v2').update({ hero_image: uploaded[0].imageUrl }).eq('id', cruise.id);
if (heroError) throw new Error(`대표 이미지 저장 실패: ${heroError.message}`);

let verified = 0;
for (const image of uploaded) {
  const response = await fetch(image.imageUrl, { method: 'HEAD' });
  if (response.ok && Number(response.headers.get('content-length')) === image.bytes) verified += 1;
}
console.log(JSON.stringify({
  mode: 'apply',
  cruise: cruise.name_ko,
  officialPage,
  uploaded: uploaded.length,
  bytes: uploaded.reduce((sum, image) => sum + image.bytes, 0),
  verified,
  heroImage: uploaded[0].imageUrl,
  manifestFile,
}, null, 2));
if (verified !== uploaded.length) process.exitCode = 1;
