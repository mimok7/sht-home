import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recoveryRoot = path.resolve(process.argv[2] || path.join(root, 'recovered-homepage-images'));
const imageRoot = path.join(recoveryRoot, 'homepage-images');
const bucket = process.argv[3] || 'homepage-images';
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.STORAGE_UPLOAD_CONCURRENCY) || 4));

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function contentType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 12).toString('ascii').match(/^ftyp(?:avif|avis)$/)) return 'image/avif';
  return 'application/octet-stream';
}

async function ensureBucket(client) {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw new Error(`버킷 목록 조회 실패: ${listError.message}`);
  if (buckets.some((item) => item.id === bucket)) return;
  const { error } = await client.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'],
  });
  if (error) throw new Error(`버킷 생성 실패: ${error.message}`);
}

async function main() {
  const env = await envFile(path.join(root, '.env.local'));
  const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await ensureBucket(client);

  const files = await walk(imageRoot);
  const results = new Array(files.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      const filename = files[index];
      const storagePath = path.relative(imageRoot, filename).replaceAll('\\', '/');
      try {
        const body = await fs.readFile(filename);
        const mime = contentType(body);
        if (mime === 'application/octet-stream') throw new Error('지원하지 않는 파일 형식');
        const { error } = await client.storage.from(bucket).upload(storagePath, body, {
          cacheControl: '31536000',
          contentType: mime,
          upsert: true,
        });
        if (error) throw error;
        results[index] = { storagePath, bytes: body.length, contentType: mime, status: 'uploaded' };
      } catch (error) {
        results[index] = { storagePath, status: 'failed', error: error?.message || String(error) };
      }
      completed += 1;
      if (completed % 25 === 0 || completed === files.length) {
        const uploaded = results.filter((item) => item?.status === 'uploaded').length;
        console.log(`업로드 ${completed}/${files.length} · 성공 ${uploaded}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const failed = results.filter((item) => item.status === 'failed');
  const summary = {
    generatedAt: new Date().toISOString(),
    platformUrl: url,
    bucket,
    files: results.length,
    uploadedFiles: results.length - failed.length,
    failedFiles: failed.length,
    uploadedBytes: results.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
  };
  await fs.writeFile(path.join(recoveryRoot, 'platform-upload-manifest.json'), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(recoveryRoot, 'platform-upload-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) process.exitCode = 1;
}

await main();
