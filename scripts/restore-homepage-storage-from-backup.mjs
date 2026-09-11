// Add-only recovery: never overwrites or deletes an existing object.
// Run without --apply first. Only byte-identical local backups or existing
// platform objects (single-part MD5 ETag + length) qualify for restoration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const backupRoot = args.find((arg) => !arg.startsWith('--'));
if (!backupRoot) throw new Error('Pass the existing backup directory');
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
if (!url || new URL(url).hostname !== 'jkhookaflhibrcafmlxn.supabase.co' || !env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Expected platform credentials');
const db = createClient(url, env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = JSON.parse(await fs.readFile('.migration-audit/source.json', 'utf8'));
const expected = manifest.objects.filter((item) => item.bucket === 'homepage-images');
const digest = (value) => String(value || '').replaceAll('"', '').toLowerCase();
const identity = (etag, size) => /^[a-f0-9]{32}$/.test(digest(etag)) ? `${digest(etag)}:${Number(size)}` : '';
const neededSizes = new Set(expected.map((item) => Number(item.size)));
const backups = new Map();
async function walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else if (entry.isFile()) {
      const stat = await fs.stat(filename);
      if (!neededSizes.has(stat.size)) continue;
      const body = await fs.readFile(filename);
      backups.set(identity(createHash('md5').update(body).digest('hex'), body.length), filename);
    }
  }
}
await walk(path.resolve(backupRoot));
const actual = new Map();
const folders = [''];
for (let cursor = 0; cursor < folders.length; cursor += 1) {
  const folder = folders[cursor];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from('homepage-images').list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const item of data) {
      const name = folder ? `${folder}/${item.name}` : item.name;
      if (!item.id) folders.push(name);
      else actual.set(name, item.metadata || {});
    }
    if (data.length < 1000) break;
  }
}
const copies = new Map([...actual].map(([name, meta]) => [identity(meta.eTag, meta.size), name]).filter(([key]) => key));
const origins = args.includes('--originals') ? JSON.parse(await fs.readFile('.migration-audit/origins.json', 'utf8')) : [];
const summary = { apply, source: expected.length, alreadyPresent: 0, copyable: 0, recoverableBackup: 0, verifiedOriginal: 0, restored: 0, unavailable: [], failed: [] };
async function restore(item) {
  if (actual.has(item.name)) { summary.alreadyPresent += 1; return; }
  const key = identity(item.etag, item.size);
  const copyFrom = key && copies.get(key);
  const filename = key && backups.get(key);
  let originalBody;
  if (!copyFrom && !filename && key) {
    const origin = origins.find((row) => row.storage_path === item.name)?.source_image_url;
    if (origin) {
      const originalUrl = new URL(origin);
      if (originalUrl.protocol === 'https:' && originalUrl.hostname.endsWith('.pstatic.net')) {
        try {
          const response = await fetch(originalUrl, { signal: AbortSignal.timeout(20000), redirect: 'error' });
          if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
            const body = Buffer.from(await response.arrayBuffer());
            if (identity(createHash('md5').update(body).digest('hex'), body.length) === key) originalBody = body;
          }
        } catch { /* An unavailable/mismatched original must never be uploaded. */ }
      }
    }
  }
  if (!copyFrom && !filename && !originalBody) { summary.unavailable.push(item.name); return; }
  if (copyFrom) summary.copyable += 1;
  else if (filename) summary.recoverableBackup += 1;
  else summary.verifiedOriginal += 1;
  if (!apply) return;
  try {
    let result;
    if (copyFrom) result = await db.storage.from('homepage-images').copy(copyFrom, item.name);
    else {
      const body = originalBody || await fs.readFile(filename);
      if (identity(createHash('md5').update(body).digest('hex'), body.length) !== key) throw new Error('Backup changed since verification');
      const extension = path.extname(item.name).toLowerCase();
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[extension];
      if (!mime) throw new Error('Unsupported image extension');
      result = await db.storage.from('homepage-images').upload(item.name, body, { upsert: false, contentType: mime, cacheControl: '31536000' });
    }
    if (result.error) throw result.error;
    summary.restored += 1;
    if (summary.restored % 25 === 0) console.log(JSON.stringify({ restored: summary.restored }));
  } catch (error) { summary.failed.push({ path: item.name, error: error.message }); }
}
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < expected.length) await restore(expected[cursor++]);
}));
console.log(JSON.stringify({ ...summary, unavailable: args.includes('--paths') ? summary.unavailable : summary.unavailable.length }, null, 2));
if (summary.failed.length) process.exitCode = 1;
