// Add missing aliases only; never replace current mappings or guess identities.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
if (!url || new URL(url).hostname !== 'jkhookaflhibrcafmlxn.supabase.co' || !env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Expected platform credentials');
const db = createClient(url, env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const source = JSON.parse(await fs.readFile('.migration-audit/details.json', 'utf8'));
async function all(table, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(select).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const [cruises, cabins, cruiseAliases, cabinAliases] = await Promise.all([
  all('cruises_v2', 'id,legacy_name,name_ko'), all('cabins_v2', 'id,cruise_id,legacy_room_name,name_ko'),
  all('cruise_aliases_v2', '*'), all('cabin_aliases_v2', '*'),
]);
const cruiseMap = new Map();
for (const old of source.cruises) {
  const matches = cruises.filter((row) => (row.legacy_name || row.name_ko) === (old.legacy_name || old.name_ko));
  if (matches.length === 1) cruiseMap.set(old.id, matches[0].id);
}
const cabinMap = new Map();
for (const old of source.cabins) {
  const matches = cabins.filter((row) => row.cruise_id === cruiseMap.get(old.cruise_id) && (row.legacy_room_name || row.name_ko) === (old.legacy_room_name || old.name_ko));
  if (matches.length === 1) cabinMap.set(old.id, matches[0].id);
}
const pending = { cruise_aliases_v2: [], cabin_aliases_v2: [] };
let conflicts = 0;
let unmatched = 0;
for (const row of source.cruise_aliases) {
  const cruiseId = cruiseMap.get(row.cruise_id);
  if (!cruiseId) { unmatched += 1; continue; }
  const current = cruiseAliases.find((item) => item.alias === row.alias);
  if (current) { if (current.cruise_id !== cruiseId) conflicts += 1; continue; }
  pending.cruise_aliases_v2.push({ ...row, cruise_id: cruiseId });
}
for (const row of source.cabin_aliases) {
  const cruiseId = cruiseMap.get(row.cruise_id), cabinId = cabinMap.get(row.cabin_id);
  if (!cruiseId || !cabinId) { unmatched += 1; continue; }
  const current = cabinAliases.find((item) => item.cruise_id === cruiseId && item.alias === row.alias);
  if (current) { if (current.cabin_id !== cabinId) conflicts += 1; continue; }
  pending.cabin_aliases_v2.push({ ...row, cruise_id: cruiseId, cabin_id: cabinId });
}
const apply = process.argv.includes('--apply');
const added = {};
if (apply) {
  for (const [table, rows] of Object.entries(pending)) {
    if (!rows.length) { added[table] = 0; continue; }
    const onConflict = table === 'cruise_aliases_v2' ? 'alias' : 'cruise_id,alias';
    const { data, error } = await db.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }).select();
    if (error) throw error;
    added[table] = data.length;
  }
}
console.log(JSON.stringify({ apply, mappedCruises: cruiseMap.size, mappedCabins: cabinMap.size, conflicts, unmatched, pending: Object.fromEntries(Object.entries(pending).map(([key, rows]) => [key, rows.length])), added }, null, 2));
