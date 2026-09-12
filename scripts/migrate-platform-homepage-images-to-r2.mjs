// Copies every platform homepage-images object to R2 without removing the
// Supabase source. The script is restart-safe: verified R2 objects are skipped.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const SOURCE_BUCKET = 'homepage-images';
const EXPECTED_PLATFORM_HOST = 'jkhookaflhibrcafmlxn.supabase.co';
const PATH_PATTERN = /^(?:cruises|hotels)\/[a-zA-Z0-9_./-]+$/;
const CONCURRENCY = 4;

const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env };
const platformUrl = String(env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL || '').replace(/\/$/, '');
const platformKey = String(env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY || '');
const r2Endpoint = String(env.R2_ENDPOINT || '').replace(/\/$/, '');
const r2Bucket = String(env.R2_BUCKET || '');
const r2AccessKeyId = String(env.R2_ACCESS_KEY_ID || '');
const r2SecretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '');

if (!platformUrl || new URL(platformUrl).hostname !== EXPECTED_PLATFORM_HOST || !platformKey) {
  throw new Error('플랫폼 Supabase 서비스 계정 설정을 확인해 주세요.');
}
if (!r2Endpoint || !r2Bucket || !r2AccessKeyId || !r2SecretAccessKey) {
  throw new Error('R2 환경 변수 4개를 확인해 주세요.');
}

const platform = createClient(platformUrl, platformKey, { auth: { persistSession: false, autoRefreshToken: false } });
const r2 = new S3Client({
  region: 'auto', endpoint: r2Endpoint,
  credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
});

function assertPath(value) {
  const path = String(value || '');
  if (!PATH_PATTERN.test(path) || path.includes('..') || path.includes('\\')) throw new Error(`허용되지 않은 이미지 경로입니다: ${path}`);
  return path;
}

function contentType(path, declaredType) {
  if (typeof declaredType === 'string' && declaredType.startsWith('image/')) return declaredType;
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.avif$/i.test(path)) return 'image/avif';
  if (/\.gif$/i.test(path)) return 'image/gif';
  return 'image/jpeg';
}

async function listObjects(bucket) {
  const objects = [];
  const folders = [''];
  for (let cursor = 0; cursor < folders.length; cursor += 1) {
    const folder = folders[cursor];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await platform.storage.from(bucket).list(folder, {
        limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      for (const item of data || []) {
        const name = folder ? `${folder}/${item.name}` : item.name;
        if (item.id) objects.push({ path: assertPath(name), metadata: item.metadata || {} });
        else folders.push(name);
      }
      if ((data || []).length < 1000) break;
    }
  }
  return objects.sort((left, right) => left.path.localeCompare(right.path));
}

async function alreadyCopied(path, expectedSize) {
  try {
    const result = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: path }));
    return Number(result.ContentLength) === Number(expectedSize);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

async function copyObject(item) {
  const expectedSize = Number(item.metadata.size || 0);
  if (expectedSize > 0 && await alreadyCopied(item.path, expectedSize)) return { status: 'existing', bytes: expectedSize };

  const { data, error } = await platform.storage.from(SOURCE_BUCKET).download(item.path);
  if (error || !data) throw error || new Error(`원본을 읽지 못했습니다: ${item.path}`);
  const body = Buffer.from(await data.arrayBuffer());
  if (!body.length || (expectedSize > 0 && body.length !== expectedSize)) {
    throw new Error(`원본 크기 검증에 실패했습니다: ${item.path}`);
  }
  await r2.send(new PutObjectCommand({
    Bucket: r2Bucket, Key: item.path, Body: body,
    ContentType: contentType(item.path, data.type || item.metadata.mimetype),
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  if (!(await alreadyCopied(item.path, body.length))) throw new Error(`R2 저장 검증에 실패했습니다: ${item.path}`);
  return { status: 'copied', bytes: body.length };
}

const objects = await listObjects(SOURCE_BUCKET);
if (!objects.length) throw new Error('이관할 이미지가 없습니다.');
const results = new Array(objects.length);
let next = 0;
let completed = 0;
let copiedBytes = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= objects.length) return;
    const item = objects[index];
    try {
      results[index] = await copyObject(item);
      copiedBytes += results[index].bytes;
    } catch (error) {
      results[index] = { status: 'failed', error: error?.message || String(error) };
    }
    completed += 1;
    if (completed % 25 === 0 || completed === objects.length) {
      const copied = results.filter((result) => result?.status === 'copied').length;
      const existing = results.filter((result) => result?.status === 'existing').length;
      const failed = results.filter((result) => result?.status === 'failed').length;
      console.log(JSON.stringify({ completed, total: objects.length, copied, existing, failed, mib: Number((copiedBytes / 1024 / 1024).toFixed(2)) }));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const failed = objects.flatMap((item, index) => results[index]?.status === 'failed' ? [{ path: item.path, error: results[index].error }] : []);
const summary = {
  sourceBucket: SOURCE_BUCKET, destinationBucket: r2Bucket, total: objects.length,
  copied: results.filter((result) => result?.status === 'copied').length,
  existing: results.filter((result) => result?.status === 'existing').length,
  failed: failed.length,
  copiedBytes,
  failures: failed.slice(0, 20),
};
console.log(JSON.stringify(summary, null, 2));
if (failed.length) process.exitCode = 1;
