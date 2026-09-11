// Read-only. Source manifest: { tables: [{table,count}], objects: [{bucket,name,size,etag}] }.
// No keys, personal data, or downloaded objects are written by this audit.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const key = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
if (new URL(url).hostname !== 'jkhookaflhibrcafmlxn.supabase.co' || !key) throw new Error('Expected platform audit credentials');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const source = JSON.parse(await fs.readFile(process.argv[2] || '.migration-audit/source.json', 'utf8'));
const tables = [];
for (const item of source.tables) {
  // Some gateways respond 204 to HEAD even for a missing relation. GET one row
  // with an exact count so absence is never mistaken for a successful check.
  const { count, error, status } = await db.from(item.table).select('*', { count: 'exact' }).limit(1);
  tables.push({ table: item.table, source: item.count, target: count, status, error: error?.code || (status >= 400 ? 'unavailable' : null) });
}
console.log(JSON.stringify({ tables }, null, 2));
const { data: buckets, error } = await db.storage.listBuckets();
if (error) throw error;
for (const bucket of [...new Set(source.objects.map((item) => item.bucket))]) {
  const expected = source.objects.filter((item) => item.bucket === bucket);
  if (!buckets.some((item) => item.id === bucket)) {
    console.log(JSON.stringify({ bucket, source: expected.length, error: 'missing bucket' }));
    continue;
  }
  const actual = new Map();
  const folders = [''];
  for (let cursor = 0; cursor < folders.length; cursor += 1) {
    const folder = folders[cursor];
    for (let offset = 0; ; offset += 1000) {
      const { data, error: listError } = await db.storage.from(bucket).list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (listError) throw listError;
      for (const object of data) {
        const name = folder ? `${folder}/${object.name}` : object.name;
        if (!object.id) folders.push(name);
        else actual.set(name, object.metadata || {});
      }
      if (data.length < 1000) break;
    }
  }
  const missing = expected.filter((item) => !actual.has(item.name));
  const sizeMismatch = expected.filter((item) => actual.has(item.name) && Number(actual.get(item.name).size) !== Number(item.size));
  const etagMismatch = expected.filter((item) => actual.has(item.name) && item.etag && actual.get(item.name).eTag && item.etag.replaceAll('"', '') !== String(actual.get(item.name).eTag).replaceAll('"', ''));
  const matchingContent = missing.filter((item) => [...actual.values()].some((meta) => item.etag && String(meta.eTag).replaceAll('"', '') === item.etag.replaceAll('"', '') && Number(meta.size) === Number(item.size)));
  console.log(JSON.stringify({ bucket, source: expected.length, target: actual.size, missing: missing.length, matchingContentElsewhere: matchingContent.length, sizeMismatch: sizeMismatch.length, etagMismatch: etagMismatch.length, ...(process.argv.includes('--paths') ? { missingPaths: missing.map((item) => item.name), sizeMismatchPaths: sizeMismatch.map((item) => item.name) } : {}) }, null, 2));
}
