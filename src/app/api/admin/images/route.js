import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
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
  'hotel-gallery': { table: 'catalog_products_v2', folder: 'hotels' },
  'hotel-room-gallery': { table: 'catalog_products_v2', folder: 'hotels' },
};

function storageStatus(error) {
  return Number(error?.statusCode || error?.status || 0);
}

function publicUrl(database, path) {
  return database.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function platformImageSource(database, target, entityId) {
  if (target === 'catalog-hero' || target === 'hotel-gallery' || target === 'hotel-room-gallery') {
    const { data, error } = await database.from('catalog_products_v2').select('service_type,source_key').eq('id', entityId).eq('source', 'sht-platform').maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 상품 원본을 찾을 수 없습니다.');
    return { serviceType: data.service_type, sourceKey: data.source_key };
  }
  if (target === 'cruise-hero') {
    const { data, error } = await database.from('cruises_v2').select('legacy_name,name_ko').eq('id', entityId).maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 크루즈 원본을 찾을 수 없습니다.');
    return { cruiseName: data.legacy_name || data.name_ko };
  }
  const { data: cabin, error: cabinError } = await database.from('cabins_v2').select('cruise_id,legacy_room_name,name_ko').eq('id', entityId).maybeSingle();
  if (cabinError || !cabin) throw cabinError || new Error('플랫폼 객실 원본을 찾을 수 없습니다.');
  const { data: cruise, error: cruiseError } = await database.from('cruises_v2').select('legacy_name,name_ko').eq('id', cabin.cruise_id).maybeSingle();
  if (cruiseError || !cruise) throw cruiseError || new Error('플랫폼 크루즈 원본을 찾을 수 없습니다.');
  return { cruiseName: cruise.legacy_name || cruise.name_ko, roomName: cabin.legacy_room_name || cabin.name_ko };
}

async function forwardPlatformImage(request, source, action, values = {}) {
  const platformAdminUrl = process.env.PLATFORM_ADMIN_URL || process.env.NEXT_PUBLIC_PLATFORM_ADMIN_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3004' : 'https://admin.stayhalong.com');
  const response = await fetch(`${platformAdminUrl.replace(/\/$/, '')}/api/admin/homepage-product-write`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${bearerToken(request)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, source, values }),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '플랫폼 이미지 저장에 실패했습니다.');
  return result;
}

function hotelImagePayload(image, isPrimary) {
  return {
    id: image.id, collection: image.collection, hotelPriceCode: image.hotel_price_code || null,
    sourceUrl: image.source_url || null, sourceImageUrl: image.source_image_url || null, imageName: image.image_name || null,
    imageUrl: image.image_url, storageBucket: image.storage_bucket, storagePath: image.storage_path,
    sortOrder: image.sort_order || 0, isPrimary,
  };
}

async function setHotelPrimaryImage(request, database, imageId) {
  const { data: image, error: imageError } = await database.from('hotel_gallery_images_v2')
    .select('id,product_id,hotel_price_code,collection,source_url,source_image_url,image_name,image_url,storage_bucket,storage_path,sort_order')
    .eq('id', imageId).maybeSingle();
  if (imageError || !image) throw imageError || new Error('대표로 지정할 이미지를 찾을 수 없습니다.');

  const { data: product, error: productError } = await database.from('catalog_products_v2')
    .select('id,source_key,manual_override').eq('id', image.product_id).eq('source', 'sht-platform').eq('service_type', 'hotel').maybeSingle();
  if (productError || !product) throw productError || new Error('호텔 상품 원본을 찾을 수 없습니다.');

  let galleryQuery = database.from('hotel_gallery_images_v2')
    .select('id,hotel_price_code,collection,source_url,source_image_url,image_name,image_url,storage_bucket,storage_path,sort_order')
    .eq('product_id', product.id);
  galleryQuery = image.hotel_price_code ? galleryQuery.eq('hotel_price_code', image.hotel_price_code) : galleryQuery.is('hotel_price_code', null);
  const { data: gallery, error: galleryError } = await galleryQuery.order('sort_order');
  if (galleryError) throw galleryError;

  const source = { serviceType: 'hotel', sourceKey: product.source_key };
  await forwardPlatformImage(request, source, 'upsertHotelImages', { images: (gallery || []).map((item) => hotelImagePayload(item, item.id === image.id)) });
  if (!image.hotel_price_code) await forwardPlatformImage(request, source, 'updateCatalogProduct', { image_url: image.image_url });

  const now = new Date().toISOString();
  let clearPrimaryQuery = database.from('hotel_gallery_images_v2').update({ is_primary: false, updated_at: now }).eq('product_id', product.id);
  clearPrimaryQuery = image.hotel_price_code ? clearPrimaryQuery.eq('hotel_price_code', image.hotel_price_code) : clearPrimaryQuery.is('hotel_price_code', null);
  const { error: clearPrimaryError } = await clearPrimaryQuery;
  if (clearPrimaryError) throw clearPrimaryError;
  const { error: primaryError } = await database.from('hotel_gallery_images_v2').update({ is_primary: true, updated_at: now }).eq('id', image.id);
  if (primaryError) throw primaryError;
  if (!image.hotel_price_code) {
    const { error: productUpdateError } = await database.from('catalog_products_v2').update({ image_url: image.image_url, manual_override: { ...(product.manual_override || {}), image_url: image.image_url }, updated_at: now }).eq('id', product.id);
    if (productUpdateError) throw productUpdateError;
  }

  revalidatePath('/');
  revalidatePath('/temp-home');
  return { imageUrl: image.image_url };
}

function targetPrefix(target, entityId, hotelPriceCode = '') {
  const config = TARGETS[target];
  if (!config) return '';
  if (target === 'hotel-room-gallery') return `${config.folder}/${entityId}/rooms/${hotelPriceCode}/`;
  return `${config.folder}/${entityId}/`;
}

function validateUploadInput({ target, entityId, contentType, size, hotelPriceCode }) {
  if (!TARGETS[target] || typeof entityId !== 'string' || !entityId || !IMAGE_TYPES.has(contentType)) {
    throw new Error('이미지 대상 또는 파일 형식을 확인해 주세요.');
  }
  if (target === 'hotel-room-gallery' && (typeof hotelPriceCode !== 'string' || !hotelPriceCode)) {
    throw new Error('객실 이미지 저장 대상을 확인해 주세요.');
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

async function assertTargetEntity(database, target, entityId, hotelPriceCode = '') {
  const config = TARGETS[target];
  let query = database.from(config.table).select('id').eq('id', entityId);
  if (target === 'catalog-hero') query = query.eq('source', 'sht-platform');
  if (target === 'hotel-gallery' || target === 'hotel-room-gallery') query = query.eq('source', 'sht-platform').eq('service_type', 'hotel');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('이미지를 연결할 상품을 찾을 수 없습니다.');
  if (target === 'hotel-room-gallery') {
    const { data: room, error: roomError } = await database.from('catalog_product_details_v2')
      .select('source_id').eq('source', 'sht-platform').eq('source_table', 'hotel_price').eq('product_id', entityId).eq('source_id', hotelPriceCode).maybeSingle();
    if (roomError) throw roomError;
    if (!room) throw new Error('선택한 호텔에 속한 객실을 찾을 수 없습니다.');
  }
}

async function requestUploadTicket(database, values) {
  validateUploadInput(values);
  const { target, entityId, contentType } = values;
  await assertTargetEntity(database, target, entityId, values.hotelPriceCode);
  await ensureMediaBucket(database);

  const galleryFolder = target === 'cabin-gallery' || target === 'hotel-gallery' || target === 'hotel-room-gallery' ? 'gallery/' : 'hero/';
  const path = `${targetPrefix(target, entityId, values.hotelPriceCode)}${galleryFolder}${randomUUID()}.${IMAGE_TYPES.get(contentType)}`;
  const { data, error } = await database.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { bucket: MEDIA_BUCKET, path: data.path, token: data.token, publicUrl: publicUrl(database, data.path) };
}

function assertExpectedPath(target, entityId, path, hotelPriceCode = '') {
  if (typeof path !== 'string' || !path.startsWith(targetPrefix(target, entityId, hotelPriceCode))) {
    throw new Error('유효하지 않은 이미지 경로입니다.');
  }
}

async function assertStoredObject(database, path) {
  const { data, error } = await database.storage.from(MEDIA_BUCKET).exists(path);
  if (error) throw error;
  if (!data) throw new Error('Storage에 업로드된 이미지를 찾을 수 없습니다.');
}

async function completeHotelUpload(request, database, { target, entityId, path, altText, hotelPriceCode = '' }) {
  const source = await platformImageSource(database, target, entityId);
  const isRoomImage = target === 'hotel-room-gallery';
  let existingQuery = database.from('hotel_gallery_images_v2').select('sort_order,is_primary').eq('product_id', entityId);
  existingQuery = isRoomImage ? existingQuery.eq('hotel_price_code', hotelPriceCode) : existingQuery.is('hotel_price_code', null);
  const { data: existing, error: existingError } = await existingQuery.order('sort_order', { ascending: false });
  if (existingError) throw existingError;

  const image = {
    id: randomUUID(), product_id: entityId, hotel_price_code: isRoomImage ? hotelPriceCode : null,
    collection: isRoomImage ? 'room_gallery' : 'hotel_gallery', source_url: null, source_image_url: null,
    image_name: altText || null, image_url: publicUrl(database, path), storage_bucket: MEDIA_BUCKET, storage_path: path,
    sort_order: (existing || []).reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), -1) + 1,
    is_primary: !(existing || []).some((item) => item.is_primary),
  };
  const { error: insertError } = await database.from('hotel_gallery_images_v2').insert(image);
  if (insertError) throw insertError;

  if (image.is_primary && !isRoomImage) {
    const { data: product, error: productError } = await database.from('catalog_products_v2').select('manual_override').eq('id', entityId).maybeSingle();
    if (productError || !product) throw productError || new Error('호텔 상품을 찾을 수 없습니다.');
    const { error: productUpdateError } = await database.from('catalog_products_v2').update({ image_url: image.image_url, manual_override: { ...(product.manual_override || {}), image_url: image.image_url }, updated_at: new Date().toISOString() }).eq('id', entityId);
    if (productUpdateError) throw productUpdateError;
  }

  after(async () => {
    try {
      await forwardPlatformImage(request, source, 'upsertHotelImages', { images: [hotelImagePayload(image, image.is_primary)] });
      if (image.is_primary && !isRoomImage) await forwardPlatformImage(request, source, 'updateCatalogProduct', { image_url: image.image_url });
    } catch (error) {
      console.error('[homepage-admin-images] delayed hotel image platform sync failed', error?.message || error);
    }
  });
  revalidatePath('/');
  revalidatePath('/temp-home');
  return { imageUrl: image.image_url, imageId: image.id, isPrimary: image.is_primary };
}

function failureResponse(error, fallback) {
  console.error('[homepage-admin-images]', error?.message || error);
  const message = error?.message || '';
  const status = /확인해 주세요|5MB|찾을 수 없습니다|유효하지 않은|지원하지 않는|저장 대상을/.test(message) ? 400 : 500;
  return Response.json({ error: status === 400 ? message : fallback }, { status });
}

function selectedImageIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('삭제할 이미지 선택을 확인해 주세요.');
  const ids = [...new Set(value.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 100))];
  if (!ids.length || ids.length !== value.length) throw new Error('삭제할 이미지 선택을 확인해 주세요.');
  return ids;
}

async function removeStoredImages(database, rows) {
  const pathsByBucket = new Map();
  for (const row of rows) {
    if (!row.storage_bucket || !row.storage_path) continue;
    const paths = pathsByBucket.get(row.storage_bucket) || [];
    paths.push(row.storage_path);
    pathsByBucket.set(row.storage_bucket, paths);
  }
  for (const [bucket, paths] of pathsByBucket) {
    const { error } = await database.storage.from(bucket).remove(paths);
    if (error && storageStatus(error) !== 404) throw error;
  }
}

async function removeCabinImages(request, database, imageIds) {
  const { data: images, error } = await database.from('cabin_images_v2')
    .select('id,storage_bucket,storage_path').in('id', imageIds);
  if (error || (images || []).length !== imageIds.length) throw error || new Error('삭제할 객실 이미지를 찾을 수 없습니다.');
  for (const image of images) await forwardPlatformImage(request, { imageId: image.id }, 'removeImage');
  const { error: deleteError } = await database.from('cabin_images_v2').delete().in('id', imageIds);
  if (deleteError) throw deleteError;
  await removeStoredImages(database, images);
  revalidatePath('/cruises');
  revalidatePath('/product/[id]', 'page');
  return { deletedCount: images.length };
}

async function removeCruiseImages(request, database, imageIds) {
  const { data: images, error } = await database.from('cruise_cafe_import_images_v2')
    .select('id,storage_bucket,storage_path').in('id', imageIds).is('cabin_id', null);
  if (error || (images || []).length !== imageIds.length) throw error || new Error('삭제할 크루즈 이미지를 찾을 수 없습니다.');
  for (const image of images) await forwardPlatformImage(request, { imageId: image.id }, 'removeImage');
  const { error: deleteError } = await database.from('cruise_cafe_import_images_v2').delete().in('id', imageIds);
  if (deleteError) throw deleteError;
  await removeStoredImages(database, images);
  revalidatePath('/cruises');
  revalidatePath('/product/[id]', 'page');
  return { deletedCount: images.length };
}

async function removeHotelImages(database, imageIds) {
  const { data: images, error } = await database.from('hotel_gallery_images_v2')
    .select('id,product_id,hotel_price_code,storage_bucket,storage_path').in('id', imageIds);
  if (error || (images || []).length !== imageIds.length) throw error || new Error('삭제할 호텔 이미지를 찾을 수 없습니다.');

  const { error: deleteError } = await database.from('hotel_gallery_images_v2').delete().in('id', imageIds);
  if (deleteError) throw deleteError;
  const scopes = new Map();
  for (const image of images) scopes.set(`${image.product_id}:${image.hotel_price_code || ''}`, { productId: image.product_id, hotelPriceCode: image.hotel_price_code || null });
  const now = new Date().toISOString();
  for (const scope of scopes.values()) {
    let query = database.from('hotel_gallery_images_v2').select('id,image_url').eq('product_id', scope.productId).order('sort_order').limit(1);
    query = scope.hotelPriceCode ? query.eq('hotel_price_code', scope.hotelPriceCode) : query.is('hotel_price_code', null);
    const { data: remaining, error: remainingError } = await query;
    if (remainingError) throw remainingError;
    let clearQuery = database.from('hotel_gallery_images_v2').update({ is_primary: false, updated_at: now }).eq('product_id', scope.productId);
    clearQuery = scope.hotelPriceCode ? clearQuery.eq('hotel_price_code', scope.hotelPriceCode) : clearQuery.is('hotel_price_code', null);
    const { error: clearError } = await clearQuery;
    if (clearError) throw clearError;
    if (remaining?.[0]) {
      const { error: primaryError } = await database.from('hotel_gallery_images_v2').update({ is_primary: true, updated_at: now }).eq('id', remaining[0].id);
      if (primaryError) throw primaryError;
    }
    if (!scope.hotelPriceCode) {
      const { data: product, error: productError } = await database.from('catalog_products_v2').select('manual_override').eq('id', scope.productId).maybeSingle();
      if (productError || !product) throw productError || new Error('호텔 상품을 찾을 수 없습니다.');
      const { error: productUpdateError } = await database.from('catalog_products_v2').update({ image_url: remaining?.[0]?.image_url || null, manual_override: { ...(product.manual_override || {}), image_url: remaining?.[0]?.image_url || '' }, updated_at: now }).eq('id', scope.productId);
      if (productUpdateError) throw productUpdateError;
    }
  }
  await removeStoredImages(database, images);
  revalidatePath('/hotels');
  revalidatePath('/hotels/[id]', 'page');
  return { deletedCount: images.length };
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
    if (body.action === 'completeUpload') {
      const { target, entityId, path, altText, hotelPriceCode } = body;
      if (!TARGETS[target] || typeof entityId !== 'string') throw new Error('이미지 저장 대상을 확인해 주세요.');
      await assertTargetEntity(database, target, entityId, hotelPriceCode);
      assertExpectedPath(target, entityId, path, hotelPriceCode);
      await assertStoredObject(database, path);
      if (target === 'hotel-gallery' || target === 'hotel-room-gallery') {
        return Response.json({ ok: true, result: await completeHotelUpload(request, database, { target, entityId, path, altText, hotelPriceCode }) });
      }
      const source = await platformImageSource(database, target, entityId);
      const imageUrl = publicUrl(database, path);
      let isPrimary = false;
      if (target === 'cruise-hero') {
        const { data: currentPrimary, error: primaryError } = await database.from('cruise_cafe_import_images_v2')
          .select('id').eq('cruise_id', entityId).is('cabin_id', null).eq('is_primary', true).limit(1).maybeSingle();
        if (primaryError) throw primaryError;
        isPrimary = !currentPrimary;
      }
      if (target === 'cabin-gallery') {
        const { data: currentPrimary, error: primaryError } = await database.from('cabin_images_v2')
          .select('id').eq('cabin_id', entityId).eq('is_primary', true).limit(1).maybeSingle();
        if (primaryError) throw primaryError;
        isPrimary = !currentPrimary;
      }
      const result = await forwardPlatformImage(request, source, 'upsertImage', {
        collection: target === 'cabin-gallery' ? 'cabin_gallery' : 'cafe_import', imageUrl,
        imageName: altText || null, storageBucket: MEDIA_BUCKET, storagePath: path,
        isPrimary,
      });
      return Response.json({ ok: true, result: { ...result, imageUrl } });
    }
    if (body.action === 'setCabinPrimaryImage') {
      return Response.json({ ok: true, result: await forwardPlatformImage(request, { imageId: body.imageId }, 'setPrimaryImage') });
    }
    if (body.action === 'setCruisePrimaryImage') {
      return Response.json({ ok: true, result: await forwardPlatformImage(request, { imageId: body.imageId }, 'setPrimaryImage') });
    }
    if (body.action === 'setHotelPrimaryImage') {
      return Response.json({ ok: true, result: await setHotelPrimaryImage(request, database, body.imageId) });
    }
    if (body.action === 'setHotelRoomPrimaryImage') {
      return Response.json({ ok: true, result: await setHotelPrimaryImage(request, database, body.imageId) });
    }
    if (body.action === 'removeCabinImages') {
      return Response.json({ ok: true, result: await removeCabinImages(request, database, selectedImageIds(body.imageIds)) });
    }
    if (body.action === 'removeCruiseImages') {
      return Response.json({ ok: true, result: await removeCruiseImages(request, database, selectedImageIds(body.imageIds)) });
    }
    if (body.action === 'removeHotelImages') {
      return Response.json({ ok: true, result: await removeHotelImages(database, selectedImageIds(body.imageIds)) });
    }
    if (body.action === 'removeCabinImage') {
      return Response.json({ ok: true, result: await removeCabinImages(request, database, selectedImageIds([body.imageId])) });
    }
    if (body.action === 'removeCruiseImage') {
      return Response.json({ ok: true, result: await removeCruiseImages(request, database, selectedImageIds([body.imageId])) });
    }
    return Response.json({ error: '지원하지 않는 이미지 작업입니다.' }, { status: 400 });
  } catch (error) {
    return failureResponse(error, '이미지 변경을 저장하지 못했습니다.');
  }
}
