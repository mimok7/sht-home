import { randomUUID } from 'node:crypto';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_BUCKET = 'homepage-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);
const TARGETS = {
  'cruise-hero': { table: 'cruises_v2', folder: 'cruises' },
  'catalog-hero': { table: 'catalog_products_v2', folder: 'catalog' },
  'cabin-gallery': { table: 'cabins_v2', folder: 'cabins' },
};

function storageStatus(error) {
  return Number(error?.statusCode || error?.status || 0);
}

function publicUrl(database, path) {
  return database.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function targetPrefix(target, entityId) {
  const config = TARGETS[target];
  return config ? `${config.folder}/${entityId}/` : '';
}

function validateUploadInput({ target, entityId, contentType, size }) {
  if (!TARGETS[target] || typeof entityId !== 'string' || !entityId || !IMAGE_TYPES.has(contentType)) {
    throw new Error('이미지 대상 또는 파일 형식을 확인해 주세요.');
  }
  if (!Number.isFinite(Number(size)) || Number(size) < 1 || Number(size) > MAX_IMAGE_BYTES) {
    throw new Error('이미지는 파일당 5MB 이하로 선택해 주세요.');
  }
}

async function ensureMediaBucket(database) {
  const bucket = await database.storage.getBucket(MEDIA_BUCKET);
  if (!bucket.error) {
    if (!bucket.data?.public) {
      const { error } = await database.storage.updateBucket(MEDIA_BUCKET, {
        public: true,
        fileSizeLimit: MAX_IMAGE_BYTES,
        allowedMimeTypes: [...IMAGE_TYPES.keys()],
      });
      if (error) throw error;
    }
    return;
  }
  if (storageStatus(bucket.error) !== 404) throw bucket.error;

  const { error } = await database.storage.createBucket(MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: [...IMAGE_TYPES.keys()],
  });
  if (error && storageStatus(error) !== 409) throw error;
}

async function assertTargetEntity(database, target, entityId) {
  const config = TARGETS[target];
  let query = database.from(config.table).select('id').eq('id', entityId);
  if (target === 'catalog-hero') query = query.eq('source', 'sht-platform');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('이미지를 연결할 상품을 찾을 수 없습니다.');
}

async function requestUploadTicket(database, values) {
  validateUploadInput(values);
  const { target, entityId, contentType } = values;
  await assertTargetEntity(database, target, entityId);
  await ensureMediaBucket(database);

  const path = `${targetPrefix(target, entityId)}${target === 'cabin-gallery' ? 'gallery/' : 'hero/'}${randomUUID()}.${IMAGE_TYPES.get(contentType)}`;
  const { data, error } = await database.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { bucket: MEDIA_BUCKET, path: data.path, token: data.token, publicUrl: publicUrl(database, data.path) };
}

function assertExpectedPath(target, entityId, path) {
  if (typeof path !== 'string' || !path.startsWith(targetPrefix(target, entityId))) {
    throw new Error('유효하지 않은 이미지 경로입니다.');
  }
}

async function assertStoredObject(database, path) {
  const { data, error } = await database.storage.from(MEDIA_BUCKET).exists(path);
  if (error) throw error;
  if (!data) throw new Error('Storage에 업로드된 이미지를 찾을 수 없습니다.');
}

async function completeCabinImage(database, cabinId, path, altText) {
  const [{ data: primary, error: primaryError }, { data: lastImage, error: orderError }] = await Promise.all([
    database.from('cabin_images_v2').select('id').eq('cabin_id', cabinId).eq('is_primary', true).maybeSingle(),
    database.from('cabin_images_v2').select('sort_order').eq('cabin_id', cabinId).order('sort_order', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (primaryError || orderError) throw primaryError || orderError;

  const isPrimary = !primary;
  const { data: image, error } = await database
    .from('cabin_images_v2')
    .insert({
      cabin_id: cabinId,
      storage_bucket: MEDIA_BUCKET,
      storage_path: path,
      alt_text: typeof altText === 'string' ? altText.trim() || null : null,
      sort_order: (lastImage?.sort_order || 0) + (lastImage ? 1 : 0),
      is_primary: isPrimary,
    })
    .select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at')
    .single();
  if (error) throw error;

  if (isPrimary) {
    const { error: cabinError } = await database.from('cabins_v2').update({ image_url: publicUrl(database, path), updated_at: new Date().toISOString() }).eq('id', cabinId);
    if (cabinError) throw cabinError;
  }
  return image;
}

async function completeUpload(database, values) {
  const { target, entityId, path, altText } = values || {};
  if (!TARGETS[target] || typeof entityId !== 'string') throw new Error('이미지 저장 대상을 확인해 주세요.');
  await assertTargetEntity(database, target, entityId);
  assertExpectedPath(target, entityId, path);
  await assertStoredObject(database, path);

  if (target === 'cabin-gallery') return { image: await completeCabinImage(database, entityId, path, altText) };

  const column = target === 'cruise-hero' ? 'hero_image' : 'image_url';
  if (target === 'catalog-hero') {
    const { data: current, error: currentError } = await database.from('catalog_products_v2').select('manual_override').eq('id', entityId).single();
    if (currentError) throw currentError;
    const { error } = await database.from('catalog_products_v2').update({ manual_override: { ...(current.manual_override || {}), image_url: publicUrl(database, path) }, updated_at: new Date().toISOString() }).eq('id', entityId);
    if (error) throw error;
    return { imageUrl: publicUrl(database, path) };
  }

  const { error } = await database.from('cruises_v2').update({ [column]: publicUrl(database, path), updated_at: new Date().toISOString() }).eq('id', entityId);
  if (error) throw error;
  return { imageUrl: publicUrl(database, path) };
}

async function setCabinPrimaryImage(database, imageId) {
  const { data: image, error: imageError } = await database
    .from('cabin_images_v2')
    .select('id,cabin_id,storage_bucket,storage_path')
    .eq('id', imageId)
    .single();
  if (imageError) throw imageError;
  if (image.storage_bucket !== MEDIA_BUCKET) throw new Error('지원하지 않는 이미지 저장소입니다.');

  const { error: clearError } = await database.from('cabin_images_v2').update({ is_primary: false, updated_at: new Date().toISOString() }).eq('cabin_id', image.cabin_id).eq('is_primary', true);
  if (clearError) throw clearError;
  const { error: primaryError } = await database.from('cabin_images_v2').update({ is_primary: true, updated_at: new Date().toISOString() }).eq('id', image.id);
  if (primaryError) throw primaryError;
  const { error: cabinError } = await database.from('cabins_v2').update({ image_url: publicUrl(database, image.storage_path), updated_at: new Date().toISOString() }).eq('id', image.cabin_id);
  if (cabinError) throw cabinError;
}

async function removeCabinImage(database, imageId) {
  const { data: image, error: imageError } = await database
    .from('cabin_images_v2')
    .select('id,cabin_id,storage_bucket,storage_path,is_primary')
    .eq('id', imageId)
    .single();
  if (imageError) throw imageError;
  if (image.storage_bucket !== MEDIA_BUCKET) throw new Error('지원하지 않는 이미지 저장소입니다.');

  const { data: replacement, error: replacementError } = await database
    .from('cabin_images_v2')
    .select('id,storage_path')
    .eq('cabin_id', image.cabin_id)
    .neq('id', image.id)
    .order('sort_order')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (replacementError) throw replacementError;

  const { error: storageError } = await database.storage.from(MEDIA_BUCKET).remove([image.storage_path]);
  if (storageError) throw storageError;
  const { error: deleteError } = await database.from('cabin_images_v2').delete().eq('id', image.id);
  if (deleteError) throw deleteError;

  if (image.is_primary && replacement) {
    const { error: replacementError } = await database.from('cabin_images_v2').update({ is_primary: true, updated_at: new Date().toISOString() }).eq('id', replacement.id);
    if (replacementError) throw replacementError;
    const { error: cabinError } = await database.from('cabins_v2').update({ image_url: publicUrl(database, replacement.storage_path), updated_at: new Date().toISOString() }).eq('id', image.cabin_id);
    if (cabinError) throw cabinError;
  } else if (image.is_primary) {
    const { error: cabinError } = await database.from('cabins_v2').update({ image_url: null, updated_at: new Date().toISOString() }).eq('id', image.cabin_id);
    if (cabinError) throw cabinError;
  }
}

function failureResponse(error, fallback) {
  console.error('[homepage-admin-images]', error?.message || error);
  const message = error?.message || '';
  const status = /확인해 주세요|5MB|찾을 수 없습니다|유효하지 않은|지원하지 않는|저장 대상을/.test(message) ? 400 : 500;
  return Response.json({ error: status === 400 ? message : fallback }, { status });
}

export async function POST(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 });
  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    return Response.json({ ok: true, upload: await requestUploadTicket(database, await request.json()) });
  } catch (error) {
    return failureResponse(error, '이미지 업로드 준비에 실패했습니다.');
  }
}

export async function PATCH(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 });
  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    const body = await request.json();
    if (body.action === 'completeUpload') return Response.json({ ok: true, result: await completeUpload(database, body) });
    if (body.action === 'setCabinPrimaryImage') {
      await setCabinPrimaryImage(database, body.imageId);
      return Response.json({ ok: true });
    }
    if (body.action === 'removeCabinImage') {
      await removeCabinImage(database, body.imageId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: '지원하지 않는 이미지 작업입니다.' }, { status: 400 });
  } catch (error) {
    return failureResponse(error, '이미지 변경을 저장하지 못했습니다.');
  }
}
