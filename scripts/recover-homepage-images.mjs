import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.resolve(process.argv[2] || path.join(root, 'recovered-homepage-images'));
const PAGE_SIZE = 1000;
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 20_000;
const OLD_PROJECT = 'tthwqfhdojncqtwfssqe.supabase.co';
const SOURCE_TABLES = new Set(['homepage_cruise_images', 'homepage_hotel_images']);

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

function cleanUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function usableSourceUrl(value) {
  const url = cleanUrl(value);
  return url && !url.includes(OLD_PROJECT) ? url : '';
}

function safeSegment(value) {
  return String(value || '').replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || '_';
}

function safeStoragePath(record, index) {
  const rawPath = String(record.payload?.storage_path || '').replaceAll('\\', '/');
  const parts = rawPath.split('/').filter((part) => part && part !== '.' && part !== '..').map(safeSegment);
  if (parts.length) return path.join(...parts);
  return path.join(record.source_table, `${safeSegment(record.source_id || index)}.img`);
}

function cacheCandidates(legacyUrl) {
  if (!legacyUrl) return [];
  return [3840, 1920, 1200, 828, 640].flatMap((width) => [75, 90].map((quality) =>
    `https://shthome.stayhalong.com/_next/image?url=${encodeURIComponent(legacyUrl)}&w=${width}&q=${quality}`));
}

function candidateUrls(record) {
  const payload = record.payload || {};
  const legacyUrl = [payload.image_url, payload.public_url]
    .map(cleanUrl)
    .find((url) => url.includes(OLD_PROJECT)) || '';
  return [...new Set([
    usableSourceUrl(payload.source_image_url),
    usableSourceUrl(payload.image_url),
    usableSourceUrl(payload.public_url),
    ...cacheCandidates(legacyUrl),
    legacyUrl,
  ].filter(Boolean))];
}

async function fetchImage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'StayHalongImageRecovery/1.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 200 || contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error(`not an image (${contentType || 'unknown'}, ${buffer.length} bytes)`);
  }
  return { buffer, contentType, finalUrl: response.url };
}

async function downloadFile(file) {
  const { relativePath, records } = file;
  const destination = path.join(outputRoot, 'homepage-images', relativePath);
  try {
    const existing = await fs.stat(destination);
    if (existing.size > 0) return { status: 'existing', relativePath, bytes: existing.size };
  } catch {}

  const errors = [];
  const urls = [...new Set(records.flatMap(candidateUrls))];
  for (const url of urls) {
    try {
      const image = await fetchImage(url);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, image.buffer);
      return { status: 'recovered', relativePath, bytes: image.buffer.length, contentType: image.contentType, recoveredFrom: image.finalUrl };
    } catch (error) {
      errors.push({ url, error: error?.message || String(error) });
    }
  }
  return { status: 'missing', relativePath, errors };
}

async function loadRecords(config) {
  const records = [];
  const sourceFilter = encodeURIComponent('in.(homepage_cruise_images,homepage_hotel_images)');
  for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
    const response = await fetch(`${config.url}/rest/v1/platform_source_records?select=source_table,source_id,payload&source=eq.sht-platform&source_table=${sourceFilter}&order=source_table.asc,source_id.asc&limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
    });
    if (!response.ok) throw new Error(`이미지 메타데이터 조회 실패: HTTP ${response.status} ${await response.text()}`);
    const page = await response.json();
    records.push(...page.filter((record) => SOURCE_TABLES.has(record.source_table)));
    if (page.length < PAGE_SIZE) break;
  }
  return records;
}

async function main() {
  const env = await envFile(path.join(root, '.env.local'));
  const url = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');

  await fs.mkdir(outputRoot, { recursive: true });
  const records = await loadRecords({ url, key });
  const filesByPath = new Map();
  records.forEach((record, index) => {
    const relativePath = safeStoragePath(record, index);
    const file = filesByPath.get(relativePath) || { relativePath, records: [] };
    file.records.push(record);
    filesByPath.set(relativePath, file);
  });
  const files = [...filesByPath.values()];
  const results = new Array(files.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      results[index] = await downloadFile(files[index]);
      completed += 1;
      if (completed % 50 === 0 || completed === files.length) {
        const recovered = results.filter((result) => result?.status === 'recovered' || result?.status === 'existing').length;
        console.log(`진행 ${completed}/${files.length} · 복구 ${recovered}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const manifest = files.map((file, index) => ({
    relativePath: file.relativePath,
    sourceRecords: file.records.map((record) => ({
      sourceTable: record.source_table,
      sourceId: record.source_id,
      payload: record.payload,
    })),
    recovery: results[index],
  }));
  const recovered = manifest.filter((item) => ['recovered', 'existing'].includes(item.recovery.status));
  const missing = manifest.filter((item) => item.recovery.status === 'missing');
  const summary = {
    generatedAt: new Date().toISOString(),
    outputRoot,
    metadataRecords: records.length,
    uniqueFiles: files.length,
    recoveredFiles: recovered.length,
    missingFiles: missing.length,
    recoveredBytes: recovered.reduce((sum, item) => sum + Number(item.recovery.bytes || 0), 0),
  };
  await fs.writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await main();
