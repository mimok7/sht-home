import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#') ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')] : null;
  }).filter(Boolean));
}

async function all(client, table, select = '*') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function publicUrl(baseUrl, bucket, storagePath) {
  return `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function nonEmptyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

async function upsertBatches(client, table, rows, onConflict, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + size), { onConflict });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

const homeEnv = await envFile(path.join(root, '.env.local'));
const platformEnv = await envFile(path.join(root, '..', 'sht-platform', 'apps', 'admin', '.env.local'));
const homeUrl = homeEnv.NEXT_PUBLIC_SUPABASE_URL;
const homeKey = homeEnv.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
const platformUrl = platformEnv.NEXT_PUBLIC_SUPABASE_URL;
const platformKey = platformEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!homeUrl || !homeKey || !platformUrl || !platformKey) throw new Error('두 프로젝트의 Supabase URL과 service role key가 필요합니다.');

const home = createClient(homeUrl, homeKey, { auth: { persistSession: false } });
const platform = createClient(platformUrl, platformKey, { auth: { persistSession: false } });
const [cruises, itineraries, tags, cabins, cabinImages, cafeImages, products, prices] = await Promise.all([
  all(home, 'cruises_v2', 'id,legacy_name,name_ko,name_en,description,category,star_rating,hero_image,is_active,created_at,updated_at'),
  all(home, 'cruise_itineraries_v2', 'id,cruise_id,schedule_type,description,is_active,created_at,updated_at'),
  all(home, 'cruise_tags_v2', 'cruise_id,tag,evidence,is_active,created_at'),
  all(home, 'cabins_v2', 'id,cruise_id,legacy_room_name,name_ko,name_en,image_url,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,is_active'),
  all(home, 'cabin_images_v2', 'id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at,updated_at'),
  all(home, 'cruise_cafe_import_images_v2', 'id,cruise_id,cabin_id,source_url,source_image_url,image_name,storage_bucket,storage_path,sort_order,created_at'),
  all(home, 'catalog_products_v2', 'service_type,source_key,manual_override'),
  all(home, 'catalog_prices_v2', 'source_table,source_id,manual_override'),
]);

const cruiseById = new Map(cruises.map((row) => [row.id, row]));
const cabinById = new Map(cabins.map((row) => [row.id, row]));
const cruiseName = (id) => cruiseById.get(id)?.legacy_name || cruiseById.get(id)?.name_ko || null;
const contentRows = cruises.map((row) => ({
  cruise_name: row.legacy_name || row.name_ko, name_ko: row.name_ko, name_en: row.name_en,
  description: row.description, category: row.category, star_rating: row.star_rating,
  hero_image: row.hero_image, is_active: row.is_active, created_at: row.created_at, updated_at: row.updated_at,
})).filter((row) => row.cruise_name);
const itineraryRows = itineraries.map((row) => ({ ...row, cruise_name: cruiseName(row.cruise_id) })).filter((row) => row.cruise_name).map(({ cruise_id, ...row }) => row);
const tagRows = tags.map((row) => ({ ...row, cruise_name: cruiseName(row.cruise_id), updated_at: row.created_at })).filter((row) => row.cruise_name).map(({ cruise_id, ...row }) => row);
const cabinOverrideRows = cabins.map((row) => ({
  cruise_name: cruiseName(row.cruise_id),
  room_name: row.legacy_room_name || row.name_ko,
  values: Object.fromEntries(Object.entries({
    name_ko: row.name_ko, name_en: row.name_en, image_url: row.image_url,
    room_area_text: row.room_area_text, bed_type: row.bed_type, max_adults: row.max_adults,
    max_guests: row.max_guests, has_balcony: row.has_balcony, is_vip: row.is_vip,
    has_butler: row.has_butler, is_recommended: row.is_recommended,
    connecting_available: row.connecting_available, extra_bed_available: row.extra_bed_available,
    facilities: row.facilities, special_amenities: row.special_amenities, is_active: row.is_active,
  }).filter(([, value]) => value !== undefined)),
})).filter((row) => row.cruise_name && row.room_name);

const imageRows = [];
for (const row of cabinImages) {
  const cabin = cabinById.get(row.cabin_id);
  const name = cabin && cruiseName(cabin.cruise_id);
  if (!name) continue;
  imageRows.push({
    id: row.id, collection: 'cabin_gallery', cruise_name: name, room_name: cabin.legacy_room_name || cabin.name_ko,
    image_name: row.alt_text, image_url: publicUrl(homeUrl, row.storage_bucket, row.storage_path),
    storage_bucket: row.storage_bucket, storage_path: row.storage_path, sort_order: row.sort_order,
    is_primary: row.is_primary, created_at: row.created_at, updated_at: row.updated_at || row.created_at,
  });
}
for (const row of cafeImages) {
  const cabin = row.cabin_id ? cabinById.get(row.cabin_id) : null;
  const name = cruiseName(row.cruise_id);
  if (!name) continue;
  imageRows.push({
    id: row.id, collection: 'cafe_import', cruise_name: name, room_name: cabin ? cabin.legacy_room_name || cabin.name_ko : null,
    source_url: row.source_url, source_image_url: row.source_image_url, image_name: row.image_name,
    image_url: publicUrl(homeUrl, row.storage_bucket, row.storage_path), storage_bucket: row.storage_bucket,
    storage_path: row.storage_path, sort_order: row.sort_order, is_primary: false,
    created_at: row.created_at, updated_at: row.created_at,
  });
}

const productOverrides = products.filter((row) => nonEmptyObject(row.manual_override)).map((row) => ({ service_type: row.service_type, source_key: row.source_key, values: row.manual_override }));
const priceOverrides = prices.filter((row) => nonEmptyObject(row.manual_override)).map((row) => ({ source_table: row.source_table, source_id: String(row.source_id), values: row.manual_override }));

await upsertBatches(platform, 'homepage_cruise_content', contentRows, 'cruise_name');
await upsertBatches(platform, 'homepage_cruise_itineraries', itineraryRows, 'cruise_name,schedule_type');
await upsertBatches(platform, 'homepage_cruise_tags', tagRows, 'cruise_name,tag');
await upsertBatches(platform, 'homepage_cruise_cabin_overrides', cabinOverrideRows, 'cruise_name,room_name');
await upsertBatches(platform, 'homepage_cruise_images', imageRows, 'collection,image_url');
await upsertBatches(platform, 'homepage_catalog_product_overrides', productOverrides, 'service_type,source_key');
await upsertBatches(platform, 'homepage_catalog_price_overrides', priceOverrides, 'source_table,source_id');

const galleryByCruise = new Map();
const galleryByRoom = new Map();
for (const row of imageRows) {
  if (row.room_name) {
    const key = `${row.cruise_name}\u0000${row.room_name}`;
    if (!galleryByRoom.has(key)) galleryByRoom.set(key, []);
    galleryByRoom.get(key).push(row);
  } else {
    if (!galleryByCruise.has(row.cruise_name)) galleryByCruise.set(row.cruise_name, []);
    galleryByCruise.get(row.cruise_name).push(row);
  }
}
for (const row of contentRows) {
  const gallery = galleryByCruise.get(row.cruise_name) || [];
  const urls = [...new Set([row.hero_image, ...gallery.sort((a, b) => a.sort_order - b.sort_order).map((image) => image.image_url)].filter(Boolean))];
  const { error } = await platform.from('cruise_info').update({ cruise_image: row.hero_image || urls[0] || null, cruise_images: urls, updated_at: new Date().toISOString() }).eq('cruise_name', row.cruise_name);
  if (error) throw new Error(`cruise_info 이미지 저장 실패 (${row.cruise_name}): ${error.message}`);
}
for (const [key, gallery] of galleryByRoom) {
  const [name, room] = key.split('\u0000');
  const sorted = gallery.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const urls = [...new Set(sorted.map((image) => image.image_url))];
  const { error } = await platform.from('cruise_info').update({ room_image: urls[0] || null, room_images: urls, updated_at: new Date().toISOString() }).eq('cruise_name', name).eq('room_name', room);
  if (error) throw new Error(`cruise_info 객실 이미지 저장 실패 (${name}/${room}): ${error.message}`);
}

const [platformContent, platformItineraries, platformTags, platformCabins, platformImages] = await Promise.all([
  all(platform, 'homepage_cruise_content', 'cruise_name'), all(platform, 'homepage_cruise_itineraries', 'id'),
  all(platform, 'homepage_cruise_tags', 'cruise_name,tag'), all(platform, 'homepage_cruise_cabin_overrides', 'cruise_name,room_name'),
  all(platform, 'homepage_cruise_images', 'id,collection,image_url'),
]);

console.log(JSON.stringify({
  homepage: { cruises: contentRows.length, itineraries: itineraryRows.length, tags: tagRows.length, cabins: cabinOverrideRows.length, cabinImages: cabinImages.length, cafeImages: cafeImages.length, totalImages: imageRows.length, productOverrides: productOverrides.length, priceOverrides: priceOverrides.length },
  platform: { cruises: platformContent.length, itineraries: platformItineraries.length, tags: platformTags.length, cabins: platformCabins.length, images: platformImages.length },
  verified: contentRows.length === platformContent.length && itineraryRows.length === platformItineraries.length && tagRows.length === platformTags.length && cabinOverrideRows.length === platformCabins.length && imageRows.length === platformImages.length,
}, null, 2));
