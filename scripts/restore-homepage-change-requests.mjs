// Add-only recovery of the three legacy admin change requests. It never deletes
// or replaces platform rows. Private screenshots are copied only when the
// source download and target upload both succeed.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const sourceUrl = 'https://tthwqfhdojncqtwfssqe.supabase.co';
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const sourceKey = env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
const targetUrl = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const targetKey = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
const manifestArg = process.argv.find((arg) => arg.startsWith('--manifest='));
const manifestPath = manifestArg?.slice('--manifest='.length);
if ((!sourceKey && !manifestPath) || !targetUrl || !targetKey) throw new Error('Source credentials or an audit manifest, plus platform credentials, are required.');
if (new URL(targetUrl).hostname !== 'jkhookaflhibrcafmlxn.supabase.co') throw new Error('Expected the platform database as target.');
const source = sourceKey ? createClient(sourceUrl, sourceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const target = createClient(targetUrl, targetKey, { auth: { persistSession: false, autoRefreshToken: false } });
const apply = process.argv.includes('--apply');

async function all(client, table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(table).select('*').range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
}

const auditManifest = manifestPath ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : null;
const [requests, comments] = auditManifest
  ? [auditManifest.requests || [], auditManifest.comments || []]
  : await Promise.all([all(source, 'admin_change_requests'), all(source, 'admin_change_request_comments')]);
const paths = [...new Set(requests.flatMap((request) => Array.isArray(request.screenshot_paths) ? request.screenshot_paths : []))];
const copied = new Set();
const failedPaths = [];
for (const path of paths) {
  if (!source) { failedPaths.push(path); continue; }
  const { data: sourceFile, error: sourceError } = await source.storage.from('admin-change-request-images').download(path);
  if (sourceError || !sourceFile) { failedPaths.push(path); continue; }
  if (!apply) { copied.add(path); continue; }
  const { error: uploadError } = await target.storage.from('admin-change-request-images').upload(path, sourceFile, {
    upsert: false, contentType: sourceFile.type || 'application/octet-stream', cacheControl: '31536000',
  });
  // A pre-existing object is already a safe, recoverable target.
  if (uploadError && Number(uploadError.statusCode || uploadError.status || 0) !== 409) { failedPaths.push(path); continue; }
  copied.add(path);
}
const recoveredRequests = requests.map((request) => ({
  ...request,
  // Preserve unavailable legacy paths in the database. This keeps the audit
  // record complete and lets a later byte recovery reconnect the attachment.
  screenshot_paths: Array.isArray(request.screenshot_paths) ? request.screenshot_paths : [],
}));
let insertedRequests = 0;
let insertedComments = 0;
if (apply) {
  if (recoveredRequests.length) {
    const { data, error } = await target.from('admin_change_requests').upsert(recoveredRequests, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`admin_change_requests: ${error.message}`);
    insertedRequests = (data || []).length;
  }
  if (comments.length) {
    const { data, error } = await target.from('admin_change_request_comments').upsert(comments, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`admin_change_request_comments: ${error.message}`);
    insertedComments = (data || []).length;
  }
}
console.log(JSON.stringify({
  apply, sourceRequests: requests.length, sourceComments: comments.length, sourceFiles: paths.length,
  transferredFiles: copied.size, unavailableFiles: failedPaths.length, insertedRequests, insertedComments,
}, null, 2));
