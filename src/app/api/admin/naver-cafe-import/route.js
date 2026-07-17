import { createHmac, timingSafeEqual } from 'node:crypto';
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_BUCKET = 'homepage-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/avif', 'avif'], ['image/gif', 'gif']]);
const PREVIEW_TTL_MS = 15 * 60 * 1000;

function badRequest(message) { throw new Error(message); }

function normalizeArticleUrl(value) {
  let url;
  try { url = new URL(value); } catch { badRequest('유효한 네이버 카페 게시물 URL을 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cafe.naver.com') badRequest('cafe.naver.com 게시물만 가져올 수 있습니다.');
  const match = url.pathname.match(/^\/f-e\/cafes\/(\d+)\/articles\/(\d+)$/);
  if (!match) badRequest('네이버 카페의 개별 게시물 URL만 지원합니다.');
  return { url: url.toString(), cafeId: match[1], articleId: match[2] };
}

function cleanText(value) {
  return (value || '').replace(/\u200b/g, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isSourceImageUrl(value) {
  try { return new URL(value).hostname.endsWith('.pstatic.net'); } catch { return false; }
}

function generatedImageName(sourceUrl, index) {
  try {
    const fileName = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || '');
    const baseName = fileName.replace(/\.[a-z0-9]+$/i, '');
    const readable = baseName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return readable ? `${String(index + 1).padStart(3, '0')} · ${readable}`.slice(0, 160) : `${String(index + 1).padStart(3, '0')} · 원본 파일`;
  } catch { return `${String(index + 1).padStart(3, '0')} · 원본 파일`; }
}

async function recognizeText(worker, imageUrl) {
  try {
    const response = await fetch(imageUrl, { headers: { Referer: 'https://cafe.naver.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { text: '', confidence: 0 };
    const thumbnail = await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 720, withoutEnlargement: true }).grayscale().jpeg({ quality: 70 }).toBuffer();
    const result = await worker.recognize(thumbnail);
    return { text: cleanText(result.data.text).slice(0, 20000), confidence: Math.round(Number(result.data.confidence || 0)) };
  } catch (error) {
    console.warn('[naver-cafe-import] ocr skipped', error?.message || error);
    return { text: '', confidence: 0 };
  }
}

async function extractOcrData(imageUrls) {
  if (!imageUrls.length || imageUrls.length > 10) badRequest('OCR은 한 번에 최대 10장씩 분석할 수 있습니다.');
  const worker = await createWorker('kor+eng');
  try { return Promise.all(imageUrls.map(async (sourceImageUrl) => ({ sourceImageUrl, ...(await recognizeText(worker, sourceImageUrl)) }))); } finally { await worker.terminate(); }
}

function previewSignature(imageUrl, expiresAt) {
  const secret = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('홈페이지 관리자 서비스 키가 설정되지 않았습니다.');
  return createHmac('sha256', secret).update(`${expiresAt}:${imageUrl}`).digest('base64url');
}

function previewUrl(request, imageUrl, expiresAt) {
  const url = new URL('/api/admin/naver-cafe-import', request.url);
  url.searchParams.set('image', imageUrl);
  url.searchParams.set('expires', String(expiresAt));
  url.searchParams.set('signature', previewSignature(imageUrl, expiresAt));
  return url.toString();
}

async function launchArticleBrowser() {
  // Vercel 함수에는 Puppeteer의 전역 Chrome 캐시가 포함되지 않는다.
  // 서버리스용 Chromium을 번들에 포함해 명시적으로 실행한다.
  if (process.env.VERCEL === '1') {
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  }
  return puppeteer.launch({ headless: true });
}

async function readArticle(sourceUrl) {
  const browser = await launchArticleBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const frame = page.frames().find((item) => item.name() === 'cafe_main');
    if (!frame) badRequest('게시물 본문을 열지 못했습니다. 로그인 또는 카페 접근 권한을 확인해 주세요.');
    await frame.waitForSelector('.title_text', { timeout: 15000 });
    const article = await frame.evaluate(() => {
      const content = document.querySelector('.se-main-container') || document.querySelector('.ArticleContentBox');
      const images = [...(content || document).querySelectorAll('img.se-image-resource, img.se-inline-image-resource')]
        .map((image) => image.currentSrc || image.src)
        .filter(Boolean);
      return { title: document.querySelector('.title_text')?.textContent || '', description: content?.innerText || '', images };
    });
    const images = [...new Set(article.images)].filter((value) => {
      try { return new URL(value).hostname.endsWith('.pstatic.net'); } catch { return false; }
    });
    const description = cleanText(article.description);
    if (!cleanText(article.title) || !description) badRequest('게시물 제목 또는 본문을 읽지 못했습니다. 공개 게시물인지 확인해 주세요.');
    return { title: cleanText(article.title), description, images };
  } finally {
    await browser.close();
  }
}

async function ensureMediaBucket(database) {
  const bucketOptions = { public: true, fileSizeLimit: MAX_IMAGE_BYTES, allowedMimeTypes: [...IMAGE_TYPES.keys()] };
  const bucket = await database.storage.getBucket(MEDIA_BUCKET);
  if (!bucket.error) {
    // 기존 버킷도 새로 지원하는 GIF 형식을 허용해야 가져오기 저장이 가능하다.
    const { error } = await database.storage.updateBucket(MEDIA_BUCKET, bucketOptions);
    if (error) throw error;
    return;
  }
  if (Number(bucket.error.statusCode || bucket.error.status) !== 404) throw bucket.error;
  const { error } = await database.storage.createBucket(MEDIA_BUCKET, bucketOptions);
  if (error && Number(error.statusCode || error.status) !== 409) throw error;
}

async function copyImages(database, cruiseId, imageUrls) {
  await ensureMediaBucket(database);
  const copied = [];
  const skipped = [];
  for (const [index, item] of imageUrls.entries()) {
    const imageUrl = typeof item === 'string' ? item : item.sourceImageUrl;
    try {
      const response = await fetch(imageUrl, { headers: { Referer: 'https://cafe.naver.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase();
      const size = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !IMAGE_TYPES.has(contentType) || (size && size > MAX_IMAGE_BYTES)) { skipped.push(imageUrl); continue; }
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) { skipped.push(imageUrl); continue; }
      const name = typeof item === 'string' ? String(index + 1).padStart(3, '0') : item.storageName;
      const safeName = String(name || index + 1).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || String(index + 1).padStart(3, '0');
      const path = `cruises/${cruiseId}/cafe-import/${safeName}.${IMAGE_TYPES.get(contentType)}`;
      const { error } = await database.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      copied.push({ sourceImageUrl: imageUrl, path, publicUrl: database.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl });
    } catch (error) {
      console.warn('[naver-cafe-import] image skipped', error?.message || error);
      skipped.push(imageUrl);
    }
  }
  return { copied, skipped };
}

async function attachCabinImages(database, cruiseId, images, fallbackAltText) {
  const cabinImages = images.filter((image) => image.assignment?.target === 'cabin');
  if (!cabinImages.length) return;
  const cabinIds = [...new Set(cabinImages.map((image) => image.assignment.cabinId))];
  const { data: existing, error: existingError } = await database.from('cabin_images_v2').select('cabin_id,sort_order,is_primary').in('cabin_id', cabinIds);
  if (existingError) throw existingError;
  const state = new Map(cabinIds.map((id) => [id, { sortOrder: -1, hasPrimary: false }]));
  for (const image of existing || []) {
    const item = state.get(image.cabin_id);
    item.sortOrder = Math.max(item.sortOrder, image.sort_order);
    item.hasPrimary ||= image.is_primary;
  }
  const rows = cabinImages.map((image) => {
    const item = state.get(image.assignment.cabinId);
    const isPrimary = !item.hasPrimary;
    item.hasPrimary ||= isPrimary;
    item.sortOrder += 1;
    return { cabin_id: image.assignment.cabinId, storage_bucket: MEDIA_BUCKET, storage_path: image.path, alt_text: cleanText(image.assignment.imageName || fallbackAltText).slice(0, 160) || null, sort_order: item.sortOrder, is_primary: isPrimary };
  });
  const { error: insertError } = await database.from('cabin_images_v2').insert(rows);
  if (insertError) throw insertError;
  const firstPrimaryByCabin = rows.filter((row) => row.is_primary);
  const updates = await Promise.all(firstPrimaryByCabin.map((row) => database.from('cabins_v2').update({ image_url: database.storage.from(MEDIA_BUCKET).getPublicUrl(row.storage_path).data.publicUrl, updated_at: new Date().toISOString() }).eq('id', row.cabin_id).eq('cruise_id', cruiseId)));
  const failedUpdate = updates.find((result) => result.error);
  if (failedUpdate) throw failedUpdate.error;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get('image') || '';
    const expiresAt = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') || '';
    const expected = previewSignature(imageUrl, expiresAt);
    if (!isSourceImageUrl(imageUrl) || !Number.isFinite(expiresAt) || expiresAt < Date.now() || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new Response('Invalid preview image request', { status: 403 });
    const image = await fetch(imageUrl, { headers: { Referer: 'https://cafe.naver.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    const contentType = image.headers.get('content-type')?.split(';')[0].toLowerCase();
    if (!image.ok || !IMAGE_TYPES.has(contentType)) return new Response('Image unavailable', { status: 404 });
    return new Response(image.body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' } });
  } catch {
    return new Response('Image unavailable', { status: 404 });
  }
}

export async function POST(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 });
  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    const body = await request.json();
    const source = normalizeArticleUrl(body.url);
    const article = await readArticle(source.url);
    if (body.action === 'preview') {
      const expiresAt = Date.now() + PREVIEW_TTL_MS;
      const images = article.images.map((sourceUrl, index) => ({ sourceUrl, previewUrl: previewUrl(request, sourceUrl, expiresAt), generatedName: generatedImageName(sourceUrl, index) }));
      return Response.json({ ok: true, article: { title: article.title, description: article.description, imageCount: images.length, images, sourceUrl: source.url } });
    }
    if (body.action === 'analyzeOcr') {
      const imageUrls = Array.isArray(body.imageUrls) ? [...new Set(body.imageUrls.filter((value) => typeof value === 'string'))] : [];
      if (imageUrls.some((imageUrl) => !article.images.includes(imageUrl))) badRequest('이 게시물의 이미지에서만 OCR 데이터를 추출할 수 있습니다.');
      return Response.json({ ok: true, extractions: await extractOcrData(imageUrls) });
    }
    if (body.action !== 'import') badRequest('지원하지 않는 가져오기 작업입니다.');
    if (typeof body.cruiseId !== 'string' || !body.cruiseId) badRequest('저장할 크루즈를 선택해 주세요.');
    const { data: cruise, error: cruiseError } = await database.from('cruises_v2').select('id').eq('id', body.cruiseId).maybeSingle();
    if (cruiseError) throw cruiseError;
    if (!cruise) badRequest('저장할 크루즈를 찾을 수 없습니다.');
    const assignments = Array.isArray(body.imageAssignments) ? body.imageAssignments : [];
    if (assignments.some((item) => !item || typeof item.sourceImageUrl !== 'string' || !article.images.includes(item.sourceImageUrl) || !['hero', 'cabin', 'ocr', 'delete'].includes(item.target) || (item.imageName !== undefined && (typeof item.imageName !== 'string' || item.imageName.length > 160)))) badRequest('미리보기에서 확인한 원본 이미지만 선택할 수 있습니다. 새로 미리보기 해 주세요.');
    const selectedImages = [...new Set(assignments.filter((item) => item.target === 'hero' || item.target === 'cabin').map((item) => item.sourceImageUrl))];
    const description = typeof body.description === 'string' ? cleanText(body.description) : article.description;
    if (body.replaceDescription !== false && !description) badRequest('저장할 상품 설명을 확인해 주세요.');
    if (description.length > 100000) badRequest('상품 설명은 100,000자 이하로 저장해 주세요.');
    const ocrExtractions = Array.isArray(body.ocrExtractions) ? body.ocrExtractions : [];
    if (ocrExtractions.some((item) => !item || typeof item.sourceImageUrl !== 'string' || !article.images.includes(item.sourceImageUrl) || typeof item.text !== 'string' || item.text.length > 20000 || typeof item.use !== 'boolean')) badRequest('OCR 추출 데이터를 다시 확인해 주세요.');
    const cabinAssignments = assignments.filter((item) => item.target === 'cabin');
    const cabinIds = [...new Set(cabinAssignments.map((item) => item.cabinId).filter((value) => typeof value === 'string' && value))];
    const cabinNames = new Map();
    if (cabinAssignments.length && cabinIds.length !== cabinAssignments.length) badRequest('객실 사진의 저장 대상을 선택해 주세요.');
    if (cabinIds.length) {
      const { data: cabins, error: cabinsError } = await database.from('cabins_v2').select('id,name_ko,name_en').eq('cruise_id', cruise.id).in('id', cabinIds);
      if (cabinsError) throw cabinsError;
      if ((cabins || []).length !== cabinIds.length) badRequest('선택한 크루즈에 속한 객실만 사진 저장 대상으로 지정할 수 있습니다.');
      if ((cabins || []).some((cabin) => !cabin.name_en?.trim())) badRequest('객실 사진을 저장하려면 해당 객실의 영문명을 먼저 입력해 주세요.');
      for (const cabin of cabins || []) cabinNames.set(cabin.id, { nameKo: cabin.name_ko, nameEn: cabin.name_en });
    }
    const nameCounters = new Map();
    const imageItems = assignments.filter((item) => item.target === 'hero' || item.target === 'cabin').map((assignment) => {
      const baseName = assignment.target === 'hero' ? 'main' : (cabinNames.get(assignment.cabinId)?.nameEn || 'cabin');
      const safeBaseName = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cabin';
      const nextNumber = (nameCounters.get(safeBaseName) || 0) + 1;
      nameCounters.set(safeBaseName, nextNumber);
      return { sourceImageUrl: assignment.sourceImageUrl, storageName: `${safeBaseName}-${String(nextNumber).padStart(3, '0')}` };
    });
    const { copied, skipped } = await copyImages(database, cruise.id, imageItems);
    const assignmentBySource = new Map(assignments.map((item) => [item.sourceImageUrl, item]));
    const copiedWithTarget = copied.map((image, index) => {
      const assignment = assignmentBySource.get(image.sourceImageUrl);
      const imageName = assignment?.target === 'hero'
        ? `${article.title} 대표 이미지`
        : `${cabinNames.get(assignment?.cabinId)?.nameKo || '크루즈'} 객실 사진 ${index + 1}`;
      return { ...image, assignment: { ...assignment, imageName: imageName.slice(0, 160) } };
    });
    if (copied.length) {
      const { error: imageRecordError } = await database.from('cruise_cafe_import_images_v2').insert(copiedWithTarget.map((image, index) => ({
        cruise_id: cruise.id, cabin_id: image.assignment?.target === 'cabin' ? image.assignment.cabinId : null, source_url: source.url, source_image_url: image.sourceImageUrl, image_name: image.assignment?.imageName || null, storage_bucket: MEDIA_BUCKET, storage_path: image.path, sort_order: index,
      })));
      if (imageRecordError) throw imageRecordError;
    }
    const selectedOcr = ocrExtractions.filter((item) => item.use && cleanText(item.text));
    if (selectedOcr.length) {
      const { error: ocrError } = await database.from('cruise_cafe_ocr_extractions_v2').insert(selectedOcr.map((item) => ({ cruise_id: cruise.id, source_url: source.url, source_image_url: item.sourceImageUrl, extracted_text: cleanText(item.text), confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null })));
      if (ocrError) throw ocrError;
    }
    await attachCabinImages(database, cruise.id, copiedWithTarget, article.title);
    const updates = { updated_at: new Date().toISOString() };
    if (body.replaceDescription !== false) updates.description = description;
    const heroImage = copiedWithTarget.find((image) => image.assignment?.target === 'hero');
    if (heroImage) updates.hero_image = heroImage.publicUrl;
    const { error: updateError } = await database.from('cruises_v2').update(updates).eq('id', cruise.id);
    if (updateError) throw updateError;
    return Response.json({ ok: true, result: { title: article.title, descriptionSaved: body.replaceDescription !== false, imageCount: copied.length, skippedImageCount: skipped.length, ocrExtractionCount: selectedOcr.length, heroImage: heroImage?.publicUrl || null, sourceUrl: source.url } });
  } catch (error) {
    console.error('[naver-cafe-import]', error?.message || error);
    const message = error?.message || '네이버 카페 게시물을 가져오지 못했습니다.';
    return Response.json({ error: message }, { status: /입력|지원|권한|선택|찾을 수|읽지 못|공개/.test(message) ? 400 : 500 });
  }
}
