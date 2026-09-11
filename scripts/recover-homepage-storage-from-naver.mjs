// Add-only recovery for legacy Naver Cafe images whose Supabase Storage API is
// unavailable. A candidate is uploaded only when its byte length and MD5 hash
// exactly match the legacy storage.objects metadata captured by the audit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const articleUrls = args.filter((arg) => !arg.startsWith('--'));
if (!articleUrls.length) throw new Error('Pass at least one public Naver Cafe article URL.');

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

async function extractArticleImages(browser, sourceUrl) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('iframe#cafe_main', { timeout: 15000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe#cafe_main');
      return Boolean(frame?.src && !frame.src.startsWith('about:blank'));
    }, { timeout: 15000 });
    let frame;
    for (let attempt = 0; attempt < 30 && !frame; attempt += 1) {
      frame = page.frames().find((item) => item.name() === 'cafe_main' && !item.url().startsWith('about:blank'));
      if (!frame) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!frame) throw new Error('Naver Cafe article frame was not available.');
    await frame.waitForSelector('img', { timeout: 15000 });
    const candidates = await frame.evaluate(() => {
      const values = [];
      for (const image of document.querySelectorAll('img, source')) {
        for (const value of [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src')]) {
          if (value) values.push(value);
        }
        for (const attribute of image.attributes || []) {
          if (attribute.value) values.push(attribute.value);
        }
        for (const part of String(image.srcset || image.getAttribute('data-srcset') || '').split(',')) {
          const value = part.trim().split(/\s+/)[0];
          if (value) values.push(value);
        }
      }
      // SmartEditor keeps original image URLs in JSON-like attributes and
      // scripts even when the rendered <img> points at a resized thumbnail.
      for (const match of document.documentElement.innerHTML.matchAll(/https?:\/\/[^"'<>\s\\]+/g)) values.push(match[0]);
      return values;
    });
    return [...new Set(candidates.map((value) => String(value).replaceAll('&amp;', '&')))].filter((value) => {
      try { return new URL(value).hostname.endsWith('.pstatic.net'); } catch { return false; }
    });
  } finally {
    await page.close();
  }
}

async function downloadCandidate(url) {
  try {
    const response = await fetch(url, {
      headers: { Referer: 'https://cafe.naver.com/', 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) return null;
    const body = Buffer.from(await response.arrayBuffer());
    return { body, key: identity(createHash('md5').update(body).digest('hex'), body.length) };
  } catch {
    return null;
  }
}

const actual = await listObjects('homepage-images');
const missing = manifest.objects.filter((item) => item.bucket === 'homepage-images' && !actual.has(item.name));
const expectedByIdentity = new Map();
for (const item of missing) {
  const key = identity(item.etag, item.size);
  if (!key) continue;
  if (!expectedByIdentity.has(key)) expectedByIdentity.set(key, []);
  expectedByIdentity.get(key).push(item);
}

const browser = await puppeteer.launch({ headless: true });
let imageUrls = [];
try {
  for (const articleUrl of articleUrls) imageUrls.push(...await extractArticleImages(browser, articleUrl));
} finally {
  await browser.close();
}
imageUrls = [...new Set(imageUrls)];

const matched = new Map();
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < imageUrls.length) {
    const imageUrl = imageUrls[cursor++];
    const candidate = await downloadCandidate(imageUrl);
    if (candidate?.key && expectedByIdentity.has(candidate.key) && !matched.has(candidate.key)) matched.set(candidate.key, candidate.body);
  }
}));

const restored = [];
const failed = [];
for (const [key, items] of expectedByIdentity) {
  const body = matched.get(key);
  if (!body) continue;
  for (const item of items) {
    if (!apply) continue;
    const extension = path.extname(item.name).toLowerCase();
    const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[extension];
    if (!contentType) { failed.push({ path: item.name, error: 'Unsupported extension' }); continue; }
    const { error } = await platform.storage.from('homepage-images').upload(item.name, body, {
      upsert: false,
      contentType,
      cacheControl: '31536000',
    });
    if (error && Number(error.statusCode || error.status || 0) !== 409) failed.push({ path: item.name, error: error.message });
    else restored.push(item.name);
  }
}

console.log(JSON.stringify({
  apply,
  articles: articleUrls.length,
  discoveredImages: imageUrls.length,
  missingBefore: missing.length,
  exactMatches: [...matched.keys()].reduce((sum, key) => sum + expectedByIdentity.get(key).length, 0),
  restored: restored.length,
  unavailable: missing.length - restored.length,
  failed,
}, null, 2));
if (failed.length) process.exitCode = 1;
