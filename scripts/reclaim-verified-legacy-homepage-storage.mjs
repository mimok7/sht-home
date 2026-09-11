// Removes only old homepage Storage objects whose bytes have already been
// verified in the platform project. This is a source-only, additive-migration
// cleanup: it never touches platform Storage or database rows.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const requestedGiB = Number(args.find((arg) => arg.startsWith('--gib='))?.slice('--gib='.length) || '1.66');
if (!Number.isFinite(requestedGiB) || requestedGiB <= 0) throw new Error('Pass a positive --gib value.');

const sourceProjectRef = 'tthwqfhdojncqtwfssqe';
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const platformUrl = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
if (!platformUrl || new URL(platformUrl).hostname !== 'jkhookaflhibrcafmlxn.supabase.co' || !env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Expected platform credentials.');
}
const platform = createClient(platformUrl, env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const manifest = JSON.parse(await fs.readFile('.migration-audit/source.json', 'utf8'));
const digest = (value) => String(value || '').replaceAll('"', '').toLowerCase();
const identity = (etag, size) => /^[a-f0-9]{32}$/.test(digest(etag)) ? `${digest(etag)}:${Number(size)}` : '';

async function listObjects(bucket) {
  const result = new Map();
  const folders = [''];
  for (let cursor = 0; cursor < folders.length; cursor += 1) {
    const folder = folders[cursor];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await platform.storage.from(bucket).list(folder, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      for (const item of data || []) {
        const name = folder ? `${folder}/${item.name}` : item.name;
        if (!item.id) folders.push(name);
        else result.set(name, item.metadata || {});
      }
      if ((data || []).length < 1000) break;
    }
  }
  return result;
}

function runStorageDelete(paths) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(executable, [
      '--yes', '-p', 'supabase@2.109.1', 'supabase', '--experimental', 'storage', 'rm', '--linked',
      ...paths.map((name) => `ss:///homepage-images/${name}`),
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error((stderr || stdout || `Storage deletion exited ${code}`).trim())));
  });
}

const platformObjects = await listObjects('homepage-images');
const sourceObjects = manifest.objects.filter((item) => item.bucket === 'homepage-images');
const eligible = sourceObjects.filter((item) => {
  const target = platformObjects.get(item.name);
  return target && identity(target.eTag, target.size) === identity(item.etag, item.size);
}).sort((left, right) => Number(right.size) - Number(left.size) || left.name.localeCompare(right.name));
const targetBytes = Math.ceil(requestedGiB * 1024 ** 3);
const selected = [];
let selectedBytes = 0;
for (const item of eligible) {
  if (selectedBytes >= targetBytes) break;
  selected.push(item);
  selectedBytes += Number(item.size);
}
if (selectedBytes < targetBytes) throw new Error('There are not enough byte-verified platform copies to meet the requested reclamation amount.');

const plan = {
  sourceProjectRef,
  apply,
  requestedGiB,
  sourceObjects: sourceObjects.length,
  verifiedEligible: eligible.length,
  selectedObjects: selected.length,
  selectedBytes,
  selectedGiB: Number((selectedBytes / 1024 ** 3).toFixed(3)),
  remainingSourceGiB: Number(((sourceObjects.reduce((sum, item) => sum + Number(item.size), 0) - selectedBytes) / 1024 ** 3).toFixed(3)),
  paths: selected.map((item) => item.name),
};
await fs.mkdir('.migration-audit', { recursive: true });
await fs.writeFile('.migration-audit/legacy-storage-reclaim-plan.json', JSON.stringify(plan, null, 2));

if (!apply) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit();
}

let deleted = 0;
const failed = [];
for (let offset = 0; offset < selected.length; offset += 100) {
  const batch = selected.slice(offset, offset + 100);
  try {
    await runStorageDelete(batch.map((item) => item.name));
    deleted += batch.length;
  } catch (error) {
    failed.push({ batchStart: offset, count: batch.length, error: error.message });
    break;
  }
}
console.log(JSON.stringify({ ...plan, deleted, failed }, null, 2));
if (failed.length) process.exitCode = 1;
