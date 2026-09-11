import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const targetSlug = process.argv[process.argv.indexOf('--target') + 1];
const bucket = 'homepage-images';
const backupDirectory = path.resolve('C:/SHT-DATA/backup/cruise-media-structured-20260911');
const userAgent = 'StayHalong official media migration/2.0';

const celina = 'https://celinaofthesea.com/wp-content/uploads';
const diana = 'https://dianacruises.com/wp-content/uploads';
const hermes = 'https://hermescruise.com/wp-content/uploads';

const TARGETS = {
  'platform-3c8c3bfe0475': {
    name: '세리나 크루즈',
    officialPage: 'https://celinaofthesea.com/',
    general: {
      main: [`${celina}/2026/08/Web-Slide-Celina_2.jpg`],
      exterior: [`${celina}/2026/08/slideshow-6.jpg`, `${celina}/2026/07/toan-canh-4-scaled.jpg`],
      interior: [
        `${celina}/2026/08/sunny-restaurant-1.jpg`, `${celina}/2026/08/sunny-restaurant-2.jpg`,
        `${celina}/2026/08/sunny-restaurant-3.jpg`, `${celina}/2026/08/Pool_2.jpg`,
        `${celina}/2026/08/Pool_3.jpg`, `${celina}/2026/08/Pool_4.jpg`,
        `${celina}/2026/08/skybar-1.jpg`, `${celina}/2026/08/golf-2.jpg`, `${celina}/2026/07/spa-1.jpg`,
      ],
    },
    cabins: [
      { name: '오션 발코니', page: 'https://celinaofthesea.com/room/ocean-balcony/', urls: Array.from({ length: 6 }, (_, index) => `${celina}/2026/08/${index === 4 ? 'Ocean' : 'ocean'}-${index + 1}-1-scaled.jpg`) },
      { name: '시니어 발코니', page: 'https://celinaofthesea.com/room/senior-balcony/', urls: Array.from({ length: 8 }, (_, index) => `${celina}/2026/08/${[3, 6, 7].includes(index) ? 'sen' : 'Sen'}-${index + 1}-1-scaled.jpg`) },
      { name: '이그제큐티브 발코니', page: 'https://celinaofthesea.com/room/executive-balcony/', urls: Array.from({ length: 7 }, (_, index) => `${celina}/2026/08/${index === 6 ? 'exe' : 'Exe'}-${index + 1}-1-scaled.jpg`) },
      { name: '문스위트', page: 'https://celinaofthesea.com/room/moon-suite/', urls: Array.from({ length: 9 }, (_, index) => `${celina}/2026/08/Moon-${index + 1}-1-scaled.jpg`) },
      { name: '프레지던트', page: 'https://celinaofthesea.com/room/president/', urls: Array.from({ length: 6 }, (_, index) => `${celina}/2026/08/president-${index + 1}-1-scaled.jpg`) },
    ],
  },
  'platform-611bbb284b03': {
    name: '다이아나 크루즈',
    officialPage: 'https://dianacruises.com/',
    general: {
      main: [`${diana}/2026/01/Dianacruises-overview1.jpg`],
      exterior: [`${diana}/2026/01/dianacruises-overview2-scaled.jpg`, `${diana}/2026/01/dianacruises-overview3.jpg`],
      interior: [
        `${diana}/2026/01/Dianacruises-restaurant-1-scaled.jpg`, `${diana}/2026/01/dianacruises-restaurant-scaled.jpeg`,
        `${diana}/2026/01/dianacruises-bar-scaled-e1768187309290.jpg`, `${diana}/2026/01/dianacruises-pool3.jpeg`,
        `${diana}/2023/04/dianacruises-pool1.jpg`, `${diana}/2023/04/dianacruises-pool2.jpg`,
        `${diana}/2023/04/dianacruises-golf.jpg`, `${diana}/2026/01/dianacruises-sundesk.jpeg`,
        `${diana}/2026/01/Spa_1-scaled.jpg`, `${diana}/2026/01/Spa_2-scaled.jpg`,
      ],
    },
    cabins: [
      { name: '주니어 발코니 (1층)', page: 'https://dianacruises.com/room/diana-junior-suites/', urls: [`${diana}/2026/01/Junior_1-scaled.jpg`, `${diana}/2026/01/Junior_1-1-scaled.jpg`, `${diana}/2026/01/Junior_5-scaled.jpg`, `${diana}/2026/02/Junior_1-scaled.jpg`] },
      { name: '시니어 발코니 (1층)', page: 'https://dianacruises.com/room/diana-senior-suites/', urls: [`${diana}/2026/01/Senior-Twin_3-scaled.jpg`, `${diana}/2026/02/Senior-Twin_3-scaled.jpg`] },
      { name: '이그제큐티브 발코니 (2층)', page: 'https://dianacruises.com/room/diana-executive-suite/', urls: [`${diana}/2025/08/Exe-Twin-1-1-scaled.jpg`, `${diana}/2025/08/Detail_1-scaled.jpg`, `${diana}/2025/08/Detail_3-scaled.jpg`, `${diana}/2025/08/Exe-Twin-scaled.jpg`, `${diana}/2025/08/Family_5-scaled.jpg`] },
      { name: '프리미어 발코니 (3층)', page: 'https://dianacruises.com/room/diana-premier-suites/', urls: [`${diana}/2026/01/Family_1-scaled.jpg`, `${diana}/2026/01/Family_2-scaled.jpg`] },
      { name: '란하 스위트 (3층 / VIP)', page: 'https://dianacruises.com/room/diana-lan-ha-suite/', urls: [`${diana}/2026/01/Ha-Long_1-scaled.jpg`] },
      { name: '하롱 스위트 (2층 / VIP)', page: 'https://dianacruises.com/room/diana-halong-suite/', urls: [`${diana}/2025/12/halong-suite-scaled.jpeg`] },
    ],
  },
  'platform-e45cc94bee00': {
    name: '헤르메스 크루즈',
    officialPage: 'https://hermescruise.com/',
    general: {
      main: [`${hermes}/2024/02/hermes-cruise-overview.jpg`],
      exterior: [`${hermes}/2024/04/about-hermes-cruise-1.jpg`, `${hermes}/2024/04/about-hermes-cruise-2.jpg`],
      interior: [
        ...Array.from({ length: 6 }, (_, index) => `${hermes}/2024/03/restaurant-on-hermes-cruise-${index + 1}.jpg`),
        ...Array.from({ length: 3 }, (_, index) => `${hermes}/2024/03/sundeck-${index + 1}.jpg`),
        `${hermes}/2024/03/swimming-pool.jpg`, `${hermes}/2024/03/hermes-cruise-massage-service-1.jpg`, `${hermes}/2024/03/hermes-cruise-massage-service-2.jpg`,
      ],
      menu: [
        `${hermes}/2024/03/Hermes-cruise-cuisine.jpg`, `${hermes}/2024/03/hermes-cruises-breakfast.jpg`,
        `${hermes}/2024/03/hermes-cruises-brunch.jpg`, `${hermes}/2024/03/hermes-cruises-lunch.jpg`, `${hermes}/2024/03/hermes-cruises-vegetarian-food.jpg`,
      ],
    },
    cabins: [
      { name: '주니어 스위트 발코니', page: 'https://hermescruise.com/junior-suite-with-balcony/', urls: [`${hermes}/2024/03/junior-suite-cabin.jpg`, `${hermes}/2024/03/balcony.jpg`, `${hermes}/2024/03/bathroom.jpg`] },
      { name: '시니어 스위트 발코니', page: 'https://hermescruise.com/senior-suite-with-balcony/', urls: [`${hermes}/2024/02/52323564178_44a09558e5_k.jpg`] },
      { name: '주니어 스위트 트리플', page: 'https://hermescruise.com/triple-junior-suite-with-balcony/', urls: [`${hermes}/2024/02/52338261783_ef1eaba8d2_k.jpg`] },
      { name: '시니어 스위트 트리플', page: 'https://hermescruise.com/triple-senior-suite/', urls: [`${hermes}/2024/02/52352149719_245b48a6bd_k.jpg`] },
      { name: '주니어 스위트 패밀리 커넥팅', page: 'https://hermescruise.com/family-junior-suite-connecting/', urls: [`${hermes}/2024/03/family-junior-connecting-room.gif`] },
      { name: '시니어 스위트 패밀리 커넥팅', page: 'https://hermescruise.com/family-senior-suite-with-balcony/', urls: [`${hermes}/2024/02/52352075573_08af194305_k.jpg`] },
      { name: '로얄 스위트 위드 테라스', page: 'https://hermescruise.com/royal-suite-with-terrace/', urls: [`${hermes}/2024/02/52337067442_bae4bc2675_k.jpg`, `${hermes}/2024/02/52320901731_ac20720e22_k.jpg`] },
      { name: '프레지던트 스위트', page: 'https://hermescruise.com/president-suite-with-terrace/', urls: [`${hermes}/2024/02/52321341300_2deb7026b2_k.jpg`, `${hermes}/2024/03/52352074323_6950cda905_k.jpg`, `${hermes}/2024/03/52338261003_262d3d5219_k.jpg`, `${hermes}/2024/03/52338261033_c3db68cc40_k.jpg`] },
    ],
  },
  'platform-0f54d21dc3f6': {
    name: '오리엔트 레거시 크루즈',
    officialPage: 'https://orientlegacycruise.com/for-cruise',
    general: {
      main: ['https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/img_banner_cruise.jpg'],
      exterior: [
        'https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/image_cruise1_1_cruise2.jpg',
        'https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/image_cruise1_8_cruise2.jpg',
      ],
      interior: [
        ...Array.from({ length: 8 }, (_, index) => `https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/image_cruise1_${index + 1}_cruise.jpg`),
        ...Array.from({ length: 6 }, (_, index) => `https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/image_cruise1_${index + 2}_cruise2.jpg`),
      ],
      menu: Array.from({ length: 8 }, (_, index) => `https://bizweb.dktcdn.net/100/548/575/themes/1143280/assets/image_cruise1_${index + 1}_cruise3.jpg`),
    },
    cabins: [
      ['하롱 디럭스', 'halong-deluxe'], ['파이포 디럭스', 'faifo-deluxe'],
      ['파이포 스위트', 'faifo-suite'], ['파이포 그랜드', 'faifo-grand-suite'],
      ['파이포 레전드', 'faifo-legend-suite'], ['사이공 스위트', 'saigon-suite'],
      ['사이공 그랜드', 'saigon-grand-suite'], ['사이공 레거시', 'saigon-legacy-suite'],
    ].map(([name, slug]) => ({ name, page: `https://orientlegacycruise.com/${slug}`, dynamic: true })),
  },
};

async function envFile(filename) {
  const source = await fs.readFile(filename, 'utf8');
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    return index > 0 && !line.trimStart().startsWith('#')
      ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
      : null;
  }).filter(Boolean));
}

function stableId(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/[\s_-]+/g, ' ');
}

function imageExtension(url, contentType = '') {
  const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
  if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

function publicUrl(baseUrl, storagePath) {
  return `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function orientImages(html, pageUrl) {
  const decoded = html.replaceAll('&amp;', '&').replaceAll('\\/', '/');
  const matches = [...decoded.matchAll(/(?:src|data-src|data-lazy-src|href)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)];
  const unique = new Map();
  for (const match of matches) {
    let url;
    try { url = new URL(match[1], pageUrl); } catch { continue; }
    if (!/\/100\/548\/575\/products\//i.test(url.pathname)) continue;
    url.protocol = 'https:';
    url.pathname = url.pathname.replace(/\/thumb\/(?:grande|large|master)\//i, '/');
    url.search = '';
    const key = url.pathname.toLowerCase();
    if (!unique.has(key)) unique.set(key, url.href);
  }
  return [...unique.values()];
}

async function pageImages(page) {
  const response = await fetch(page, { headers: { 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`공식 페이지 조회 실패 (${response.status}): ${page}`);
  return orientImages(await response.text(), page);
}

async function sourcePlan(target) {
  const images = [];
  for (const [category, urls] of Object.entries(target.general || {})) {
    urls.forEach((url) => images.push({ kind: 'general', category, sourcePage: target.officialPage, url }));
  }
  for (const [category, page] of target.generalPages || []) {
    const urls = await pageImages(page);
    urls.forEach((url) => images.push({ kind: 'general', category, sourcePage: page, url }));
  }
  for (const cabin of target.cabins) {
    const urls = cabin.dynamic ? await pageImages(cabin.page) : cabin.urls;
    if (!urls?.length) throw new Error(`객실 공식 이미지를 찾지 못했습니다: ${cabin.name}`);
    urls.forEach((url) => images.push({ kind: 'cabin', cabinName: cabin.name, sourcePage: cabin.page, url }));
  }
  const seen = new Set();
  return images.filter((image) => {
    const key = image.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function download(image) {
  const response = await fetch(image.url, { headers: { Referer: image.sourcePage, 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`공식 이미지 다운로드 실패 (${response.status}): ${image.url}`);
  const contentType = (response.headers.get('content-type') || '').split(';')[0];
  if (!contentType.startsWith('image/')) throw new Error(`이미지가 아닌 응답: ${image.url}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength < 1024) throw new Error(`이미지 파일이 너무 작습니다: ${image.url}`);
  return { ...image, contentType, data, bytes: data.byteLength };
}

async function all(query, label) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function upsertBatches(database, table, rows, onConflict = 'id') {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await database.from(table).upsert(rows.slice(index, index + 200), { onConflict });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

if (!targetSlug || !TARGETS[targetSlug]) {
  throw new Error(`--target에는 다음 중 하나가 필요합니다: ${Object.keys(TARGETS).join(', ')}`);
}

const env = await envFile(path.join(root, '.env.local'));
const platformUrl = env.PLATFORM_SUPABASE_URL || env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const serviceKey = env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
if (!platformUrl || !serviceKey) throw new Error('플랫폼 Supabase URL과 service role key가 필요합니다.');
const database = createClient(platformUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const target = TARGETS[targetSlug];

const [{ data: cruise, error: cruiseError }, plan] = await Promise.all([
  database.from('cruises_v2').select('id,slug,legacy_name,name_ko,hero_image').eq('slug', targetSlug).eq('is_active', true).single(),
  sourcePlan(target),
]);
if (cruiseError || !cruise) throw new Error(`대상 크루즈 조회 실패: ${cruiseError?.message || targetSlug}`);
const { data: cabinRows, error: cabinError } = await database
  .from('cabins_v2')
  .select('id,legacy_room_name,name_ko,name_en,image_url,is_active')
  .eq('cruise_id', cruise.id)
  .eq('is_active', true);
if (cabinError) throw new Error(`객실 조회 실패: ${cabinError.message}`);
const cabinByName = new Map();
for (const cabin of cabinRows || []) {
  for (const name of [cabin.name_ko, cabin.legacy_room_name]) if (name) cabinByName.set(normalized(name), cabin);
}
const missingCabins = target.cabins.map((item) => item.name).filter((name) => !cabinByName.has(normalized(name)));
if (missingCabins.length) throw new Error(`DB 객실 연결 실패: ${missingCabins.join(', ')}`);

const plannedByCabin = Object.fromEntries(target.cabins.map((cabin) => [cabin.name, plan.filter((image) => image.cabinName === cabin.name).length]));
const plannedByCategory = Object.fromEntries(['main', 'exterior', 'interior', 'menu'].map((category) => [category, plan.filter((image) => image.category === category).length]).filter(([, count]) => count));
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', cruise: cruise.name_ko, slug: targetSlug, general: plannedByCategory, cabins: plannedByCabin, images: plan.length }, null, 2));
  process.exit(0);
}

const downloaded = [];
for (const image of plan) downloaded.push(await download(image));

const [existingImports, existingCabinImages, existingSourceImages] = await Promise.all([
  all((from, to) => database.from('cruise_cafe_import_images_v2').select('*').eq('cruise_id', cruise.id).range(from, to), '기존 크루즈 이미지 조회 실패'),
  all((from, to) => database.from('cabin_images_v2').select('*').in('cabin_id', (cabinRows || []).map((row) => row.id)).range(from, to), '기존 객실 이미지 조회 실패'),
  all((from, to) => database.from('homepage_cruise_images').select('*').eq('cruise_name', cruise.legacy_name || cruise.name_ko).range(from, to), '기존 이미지 원본 조회 실패'),
]);
await fs.mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDirectory, `${targetSlug}-${stamp}.json`);
await fs.writeFile(backupFile, JSON.stringify({ generatedAt: new Date().toISOString(), cruise, cabins: cabinRows, existingImports, existingCabinImages, existingSourceImages }, null, 2));

const orderByGroup = new Map();
const uploaded = [];
for (const image of downloaded) {
  const cabin = image.cabinName ? cabinByName.get(normalized(image.cabinName)) : null;
  const group = image.kind === 'cabin' ? `cabin/${cabin.id}` : image.category;
  const order = orderByGroup.get(group) || 0;
  orderByGroup.set(group, order + 1);
  const ext = imageExtension(image.url, image.contentType);
  const sourceHash = crypto.createHash('sha256').update(image.url).digest('hex').slice(0, 12);
  const imageName = image.kind === 'cabin'
    ? `cabin-${String(order + 1).padStart(3, '0')}.${ext}`
    : `${image.category}-${String(order + 1).padStart(3, '0')}.${ext}`;
  const storagePath = `cruises/${cruise.id}/official-structured/${group}/${sourceHash}.${ext}`;
  const { error: uploadError } = await database.storage.from(bucket).upload(storagePath, image.data, {
    contentType: image.contentType,
    cacheControl: '31536000',
    upsert: true,
  });
  if (uploadError) throw new Error(`플랫폼 Storage 업로드 실패 (${imageName}): ${uploadError.message}`);
  uploaded.push({
    ...image,
    id: stableId(`${cruise.id}\u0000structured\u0000${group}\u0000${image.url}`),
    cabin,
    imageName,
    storagePath,
    imageUrl: publicUrl(platformUrl, storagePath),
    sortOrder: order,
    isPrimary: order === 0,
  });
}

const now = new Date().toISOString();
const sourceRows = uploaded.map((image) => ({
  id: image.id,
  collection: image.kind === 'cabin' ? 'cabin_gallery' : 'cafe_import',
  cruise_name: cruise.legacy_name || cruise.name_ko,
  room_name: image.cabinName || null,
  source_url: image.sourcePage,
  source_image_url: image.url,
  image_name: image.imageName,
  image_url: image.imageUrl,
  storage_bucket: bucket,
  storage_path: image.storagePath,
  sort_order: image.sortOrder,
  is_primary: image.isPrimary,
  updated_at: now,
}));
const generalRows = uploaded.filter((image) => image.kind === 'general').map((image) => ({
  id: image.id,
  cruise_id: cruise.id,
  cabin_id: null,
  source_url: image.sourcePage,
  source_image_url: image.url,
  image_name: image.imageName,
  storage_bucket: bucket,
  storage_path: image.storagePath,
  sort_order: image.sortOrder,
  is_primary: image.isPrimary,
}));
const roomRows = uploaded.filter((image) => image.kind === 'cabin').map((image) => ({
  id: image.id,
  cabin_id: image.cabin.id,
  storage_bucket: bucket,
  storage_path: image.storagePath,
  alt_text: `${image.cabinName} 객실 이미지 ${image.sortOrder + 1}`,
  sort_order: image.sortOrder,
  is_primary: image.isPrimary,
  updated_at: now,
}));

await upsertBatches(database, 'homepage_cruise_images', sourceRows);
await upsertBatches(database, 'cruise_cafe_import_images_v2', generalRows);
await upsertBatches(database, 'cabin_images_v2', roomRows);
const hero = uploaded.find((image) => image.category === 'main')?.imageUrl || cruise.hero_image;
if (hero) {
  const { error } = await database.from('cruises_v2').update({ hero_image: hero }).eq('id', cruise.id);
  if (error) throw new Error(`대표 이미지 저장 실패: ${error.message}`);
}
for (const cabin of target.cabins) {
  const primary = uploaded.find((image) => image.cabinName === cabin.name && image.isPrimary);
  const { error } = await database.from('cabins_v2').update({ image_url: primary.imageUrl }).eq('id', primary.cabin.id);
  if (error) throw new Error(`객실 대표 이미지 저장 실패 (${cabin.name}): ${error.message}`);
}

const [verifiedImports, verifiedCabinRows] = await Promise.all([
  database.from('cruise_cafe_import_images_v2').select('id').eq('cruise_id', cruise.id).in('id', generalRows.map((row) => row.id)),
  database.from('cabin_images_v2').select('id,cabin_id').in('id', roomRows.map((row) => row.id)),
]);
if (verifiedImports.error || verifiedCabinRows.error) throw new Error(`저장 검증 실패: ${verifiedImports.error?.message || verifiedCabinRows.error?.message}`);
let verifiedFiles = 0;
for (const image of uploaded) {
  const response = await fetch(image.imageUrl, { method: 'HEAD' });
  if (response.ok) verifiedFiles += 1;
}
const verifiedCabinCounts = Object.fromEntries(target.cabins.map((cabin) => [
  cabin.name,
  (verifiedCabinRows.data || []).filter((row) => row.cabin_id === cabinByName.get(normalized(cabin.name)).id).length,
]));
console.log(JSON.stringify({
  mode: 'apply', cruise: cruise.name_ko, slug: targetSlug, general: plannedByCategory,
  cabins: verifiedCabinCounts, uploaded: uploaded.length, verifiedFiles,
  verifiedGeneralRows: verifiedImports.data?.length || 0,
  verifiedCabinRows: verifiedCabinRows.data?.length || 0,
  heroImage: hero, backupFile,
}, null, 2));
if (verifiedFiles !== uploaded.length || verifiedImports.data?.length !== generalRows.length || verifiedCabinRows.data?.length !== roomRows.length) process.exitCode = 1;
