// Restore missing legacy hotel image associations, keeping current images and
// their categorisation/primary selection. Requires exact product source keys.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
if (!url || new URL(url).hostname !== 'jkhookaflhibrcafmlxn.supabase.co' || !env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Expected platform credentials');
const db = createClient(url, env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const source = JSON.parse(await fs.readFile('.migration-audit/details.json', 'utf8'));
async function all(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select('*').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const [catalogue, currentSource, currentGallery] = await Promise.all([
  all('catalog_products_v2'), all('homepage_hotel_images'), all('hotel_gallery_images_v2'),
]);
const products = catalogue.filter((item) => item.service_type === 'hotel' && item.source === 'sht-platform');
const apply = process.argv.includes('--apply');
const result = { apply, expected: source.hotels.length, matchedProducts: 0, alreadyRepresented: 0, missingFiles: 0, unmatchedProducts: 0, pending: 0, sourceAdded: 0, galleryAdded: 0 };
const matched = new Set();
for (const old of source.hotels) {
  const oldProduct = source.products.find((item) => item.id === old.product_id);
  const matches = oldProduct ? products.filter((item) => item.source_key === oldProduct.source_key) : [];
  if (matches.length !== 1) { result.unmatchedProducts += 1; continue; }
  const product = matches[0]; matched.add(product.id);
  // Never restore an obsolete assignment when the image has already been
  // reclassified in the current catalogue, even under a different ID/path.
  const sameImage = (item) => (item.storage_path && item.storage_path === old.storage_path) || (item.source_image_url && item.source_image_url === old.source_image_url);
  const represented = currentGallery.some((item) => item.product_id === product.id && sameImage(item));
  if (represented) { result.alreadyRepresented += 1; continue; }
  if (old.storage_bucket !== 'homepage-images' || !old.storage_path) { result.missingFiles += 1; continue; }
  const imageUrl = `${url}/storage/v1/object/public/homepage-images/${old.storage_path.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) { result.missingFiles += 1; continue; }
  const existingSource = currentSource.find((item) => item.hotel_code === product.source_key && sameImage(item));
  const gallery = { ...old, id: existingSource?.id || old.id, product_id: product.id, image_url: imageUrl, is_primary: existingSource?.is_primary || false, updated_at: new Date().toISOString() };
  result.pending += 1;
  if (!apply) continue;
  if (!existingSource) {
    const { product_id: _productId, ...image } = gallery;
    const { data, error } = await db.from('homepage_hotel_images').upsert({ ...image, hotel_code: product.source_key }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw error;
    result.sourceAdded += data.length;
  }
  const { data, error } = await db.from('hotel_gallery_images_v2').upsert(gallery, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  result.galleryAdded += data.length;
  currentGallery.push(gallery);
}
result.matchedProducts = matched.size;
console.log(JSON.stringify(result, null, 2));
