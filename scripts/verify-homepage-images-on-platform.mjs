import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recoveryRoot = path.resolve(process.argv[2] || path.join(root, 'recovered-homepage-images'));
const imageRoot = path.join(recoveryRoot, 'homepage-images');
const bucket = process.argv[3] || 'homepage-images';
const CONCURRENCY = 16;

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

function publicUrl(origin, storagePath) {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function main() {
  const env = await envFile(path.join(root, '.env.local'));
  const origin = String(env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL || '').replace(/\/$/, '');
  if (!origin) throw new Error('플랫폼 Supabase URL이 필요합니다.');
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
      const expectedBytes = (await fs.stat(filename)).size;
      try {
        const response = await fetch(publicUrl(origin, storagePath), { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20_000) });
        const actualBytes = Number(response.headers.get('content-length'));
        results[index] = {
          storagePath,
          expectedBytes,
          actualBytes: Number.isFinite(actualBytes) ? actualBytes : null,
          contentType: response.headers.get('content-type'),
          status: response.ok && actualBytes === expectedBytes ? 'verified' : 'failed',
          httpStatus: response.status,
        };
      } catch (error) {
        results[index] = { storagePath, expectedBytes, status: 'failed', error: error?.message || String(error) };
      }
      completed += 1;
      if (completed % 100 === 0 || completed === files.length) {
        const verified = results.filter((item) => item?.status === 'verified').length;
        console.log(`검증 ${completed}/${files.length} · 일치 ${verified}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const failures = results.filter((item) => item.status === 'failed');
  const summary = {
    generatedAt: new Date().toISOString(),
    platformUrl: origin,
    bucket,
    files: results.length,
    verifiedFiles: results.length - failures.length,
    failedFiles: failures.length,
    verifiedBytes: results.filter((item) => item.status === 'verified').reduce((sum, item) => sum + item.expectedBytes, 0),
  };
  await fs.writeFile(path.join(recoveryRoot, 'platform-verification-manifest.json'), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(recoveryRoot, 'platform-verification-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exitCode = 1;
}

await main();
