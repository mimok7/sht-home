import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { syncPlatformCruiseV2 } from '../src/lib/sync-platform-cruise-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
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

const homeEnv = await envFile(path.join(root, '.env.local'));
const platformEnv = await envFile(path.join(root, '..', 'sht-platform', 'apps', 'admin', '.env.local'));
const home = createClient(homeEnv.NEXT_PUBLIC_SUPABASE_URL, homeEnv.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const platform = createClient(platformEnv.NEXT_PUBLIC_SUPABASE_URL, platformEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const tables = {
  cruise_info: '*',
  cruise_rate_card: '*',
  homepage_cruise_content: '*',
  homepage_cruise_itineraries: '*',
  homepage_cruise_tags: '*',
  homepage_cruise_images: '*',
  homepage_cruise_cabin_overrides: '*',
};
const entries = await Promise.all(Object.entries(tables).map(async ([table, select]) => [table, await all(platform, table, select)]));
const catalogs = Object.fromEntries(entries);
const result = await syncPlatformCruiseV2(home, catalogs);

const [cruises, cabins, itineraries, tags, cabinImages, cafeImages] = await Promise.all([
  all(home, 'cruises_v2', 'id,legacy_name,is_active'),
  all(home, 'cabins_v2', 'id,is_active'),
  all(home, 'cruise_itineraries_v2', 'id'),
  all(home, 'cruise_tags_v2', 'cruise_id,tag'),
  all(home, 'cabin_images_v2', 'id'),
  all(home, 'cruise_cafe_import_images_v2', 'id'),
]);

console.log(JSON.stringify({
  source: Object.fromEntries(entries.map(([table, rows]) => [table, rows.length])),
  result,
  homepageCache: {
    cruises: cruises.length,
    activeCruises: cruises.filter((row) => row.is_active).length,
    cabins: cabins.length,
    activeCabins: cabins.filter((row) => row.is_active).length,
    itineraries: itineraries.length,
    tags: tags.length,
    cabinImages: cabinImages.length,
    cafeImages: cafeImages.length,
    totalImages: cabinImages.length + cafeImages.length,
    imageIdsMatch: new Set([...cabinImages, ...cafeImages].map((row) => row.id)).size === catalogs.homepage_cruise_images.length
      && catalogs.homepage_cruise_images.every((row) => cabinImages.some((image) => image.id === row.id) || cafeImages.some((image) => image.id === row.id)),
  },
}, null, 2));
