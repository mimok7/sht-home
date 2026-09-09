import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
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

async function all(client, table, select) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function upsertBatches(client, table, rows, onConflict, size = 250) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + size), { onConflict });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/[\s_-]+/g, ' ');
}

function storageKey(row) {
  return `${row.storage_bucket || ''}\u0000${row.storage_path || ''}`;
}

function publicUrl(baseUrl, bucket, storagePath) {
  const encodedPath = String(storagePath).split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function basename(row) {
  return String(row.storage_path || '').split('/').pop() || String(row.image_name || '');
}

function sourceOrder(left, right) {
  return Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary))
    || Number(left.sort_order || 0) - Number(right.sort_order || 0)
    || basename(left).localeCompare(basename(right), undefined, { numeric: true });
}

const env = await envFile(path.join(root, '.env.local'));
const platformUrl = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const serviceKey = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
if (!platformUrl || !serviceKey) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
const database = createClient(platformUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [cruises, cabins, sourceImages, existingCafe, existingCabin] = await Promise.all([
  all(database, 'cruises_v2', 'id,slug,legacy_name,name_ko,hero_image,is_active'),
  all(database, 'cabins_v2', 'id,cruise_id,legacy_room_name,name_ko,image_url,is_active'),
  all(database, 'homepage_cruise_images', 'id,cruise_name,room_name,collection,source_url,source_image_url,image_name,image_url,storage_bucket,storage_path,sort_order,is_primary,created_at,updated_at'),
  all(database, 'cruise_cafe_import_images_v2', 'id,cruise_id,cabin_id,source_url,source_image_url,image_name,storage_bucket,storage_path,sort_order,is_primary,created_at'),
  all(database, 'cabin_images_v2', 'id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at,updated_at'),
]);

const cruiseByName = new Map();
for (const cruise of cruises) {
  for (const name of [cruise.legacy_name, cruise.name_ko]) {
    if (name) cruiseByName.set(normalized(name), cruise);
  }
}
const cabinsByCruise = new Map();
for (const cabin of cabins) {
  if (!cabinsByCruise.has(cabin.cruise_id)) cabinsByCruise.set(cabin.cruise_id, new Map());
  for (const name of [cabin.legacy_room_name, cabin.name_ko]) {
    if (name) cabinsByCruise.get(cabin.cruise_id).set(normalized(name), cabin);
  }
}

const existingCafeByPath = new Map(existingCafe.map((row) => [`${row.cruise_id}\u0000${storageKey(row)}`, row]));
const existingCabinByPath = new Map(existingCabin.map((row) => [storageKey(row), row]));
const cafeRows = [];
const cabinRows = [];
const unmatchedCruises = [];
const unmatchedCabins = [];
const sourceByCruise = new Map();

for (const source of sourceImages) {
  const cruise = cruiseByName.get(normalized(source.cruise_name));
  if (!cruise) {
    unmatchedCruises.push({ id: source.id, cruiseName: source.cruise_name });
    continue;
  }
  if (!source.storage_bucket || !source.storage_path) continue;
  if (!sourceByCruise.has(cruise.id)) sourceByCruise.set(cruise.id, []);
  sourceByCruise.get(cruise.id).push(source);
  const cabin = source.room_name
    ? cabinsByCruise.get(cruise.id)?.get(normalized(source.room_name)) || null
    : null;
  if (source.room_name && !cabin) {
    unmatchedCabins.push({ id: source.id, cruiseName: source.cruise_name, roomName: source.room_name, collection: source.collection });
  }

  if (source.collection === 'cafe_import') {
    const existing = existingCafeByPath.get(`${cruise.id}\u0000${storageKey(source)}`);
    cafeRows.push({
      id: existing?.id || source.id,
      cruise_id: cruise.id,
      cabin_id: cabin?.id || null,
      source_url: source.source_url || source.image_url || null,
      source_image_url: source.source_image_url || source.image_url || null,
      image_name: source.image_name || basename(source),
      storage_bucket: source.storage_bucket,
      storage_path: source.storage_path,
      sort_order: Number(source.sort_order || 0),
      is_primary: Boolean(source.is_primary),
    });
  }

  if (source.collection === 'cabin_gallery' && cabin) {
    const existing = existingCabinByPath.get(storageKey(source));
    cabinRows.push({
      id: existing?.id || source.id,
      cabin_id: cabin.id,
      storage_bucket: source.storage_bucket,
      storage_path: source.storage_path,
      alt_text: source.image_name || `${cabin.name_ko || cabin.legacy_room_name} 객실 이미지`,
      sort_order: Number(source.sort_order || 0),
      is_primary: Boolean(source.is_primary),
      updated_at: new Date().toISOString(),
    });
  }
}

const heroUpdates = [];
for (const cruise of cruises.filter((row) => row.is_active)) {
  const sources = (sourceByCruise.get(cruise.id) || []).filter((row) => row.collection === 'cafe_import' && !row.room_name);
  const ordered = [...sources].sort(sourceOrder);
  const main = ordered.find((row) => /^main-/i.test(basename(row))) || ordered[0];
  if (!main) continue;
  heroUpdates.push({
    id: cruise.id,
    slug: cruise.slug,
    previous: cruise.hero_image,
    next: publicUrl(platformUrl, main.storage_bucket, main.storage_path),
  });
}

const cabinImageUpdates = [];
const cabinSources = new Map();
for (const source of sourceImages.filter((row) => row.collection === 'cabin_gallery' && row.room_name)) {
  const cruise = cruiseByName.get(normalized(source.cruise_name));
  const cabin = cruise && cabinsByCruise.get(cruise.id)?.get(normalized(source.room_name));
  if (!cabin || !source.storage_bucket || !source.storage_path) continue;
  if (!cabinSources.has(cabin.id)) cabinSources.set(cabin.id, []);
  cabinSources.get(cabin.id).push(source);
}
for (const [cabinId, sources] of cabinSources) {
  const main = [...sources].sort(sourceOrder)[0];
  cabinImageUpdates.push({ id: cabinId, next: publicUrl(platformUrl, main.storage_bucket, main.storage_path) });
}

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  sourceImages: sourceImages.length,
  sourceCafeImages: sourceImages.filter((row) => row.collection === 'cafe_import').length,
  sourceCabinImages: sourceImages.filter((row) => row.collection === 'cabin_gallery').length,
  cafeRows: cafeRows.length,
  cabinRows: cabinRows.length,
  unmatchedCruises: unmatchedCruises.length,
  unmatchedCabinRows: unmatchedCabins.length,
  unmatchedCabins: [...new Map(unmatchedCabins.map((row) => [`${row.cruiseName}\u0000${row.roomName}`, row])).values()],
  heroUpdates: heroUpdates.length,
  cabinImageUpdates: cabinImageUpdates.length,
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

await fs.mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDirectory, `platform-cruise-image-links-before-${stamp}.json`);
await fs.writeFile(backupFile, JSON.stringify({ generatedAt: new Date().toISOString(), existingCafe, existingCabin, cruises, cabins }, null, 2));

await upsertBatches(database, 'cruise_cafe_import_images_v2', cafeRows, 'id');
await upsertBatches(database, 'cabin_images_v2', cabinRows, 'id');
for (const update of heroUpdates) {
  const { error } = await database.from('cruises_v2').update({ hero_image: update.next }).eq('id', update.id);
  if (error) throw new Error(`대표 이미지 저장 실패 (${update.slug}): ${error.message}`);
}
for (const update of cabinImageUpdates) {
  const { error } = await database.from('cabins_v2').update({ image_url: update.next }).eq('id', update.id);
  if (error) throw new Error(`객실 대표 이미지 저장 실패 (${update.id}): ${error.message}`);
}

const [verifiedCafe, verifiedCabin] = await Promise.all([
  all(database, 'cruise_cafe_import_images_v2', 'id,cruise_id,storage_bucket,storage_path'),
  all(database, 'cabin_images_v2', 'id,cabin_id,storage_bucket,storage_path'),
]);
const verifiedCafePaths = new Set(verifiedCafe.map((row) => `${row.cruise_id}\u0000${storageKey(row)}`));
const verifiedCabinPaths = new Set(verifiedCabin.map(storageKey));
const missingCafe = cafeRows.filter((row) => !verifiedCafePaths.has(`${row.cruise_id}\u0000${storageKey(row)}`));
const missingCabin = cabinRows.filter((row) => !verifiedCabinPaths.has(storageKey(row)));
console.log(JSON.stringify({
  ...summary,
  backupFile,
  verifiedCafeRows: verifiedCafe.length,
  verifiedCabinRows: verifiedCabin.length,
  missingCafe: missingCafe.length,
  missingCabin: missingCabin.length,
}, null, 2));
if (missingCafe.length || missingCabin.length) process.exitCode = 1;
