import { randomUUID } from 'node:crypto';
import { assertR2Object, createR2DownloadUrl, createR2UploadUrl, isPrivateR2ImagePath } from '@/lib/r2-storage';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCUMENT_TYPES = new Set(['passport', 'boarding_code']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PRIVATE_CACHE_CONTROL = 'private, no-store';

function markerPath(value) {
  const source = String(value || '');
  return source.startsWith('r2:') ? source.slice(3) : '';
}

function errorResponse(error, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : '여행 서류를 처리하지 못했습니다.' }, { status });
}

async function operatorContext(request) {
  const [operator, database] = await Promise.all([getHomepageOperator(request), Promise.resolve(getHomepageDatabase())]);
  if (!operator) throw new Error('운영자 로그인이 필요합니다.');
  if (!database) throw new Error('여행 서류 저장소 설정을 확인하지 못했습니다.');
  return { operator, database };
}

async function reservationContext(database, userId, reservationId) {
  const { data: reservation, error: reservationError } = await database.from('reservation')
    .select('re_id,re_user_id')
    .eq('re_id', reservationId)
    .eq('re_user_id', userId)
    .eq('re_type', 'cruise')
    .maybeSingle();
  if (reservationError) throw reservationError;
  if (!reservation) throw new Error('연결된 크루즈 예약을 찾을 수 없습니다.');
  const { data: cruise, error: cruiseError } = await database.from('reservation_cruise')
    .select('reservation_id,checkin,room_price_code')
    .eq('reservation_id', reservationId)
    .maybeSingle();
  if (cruiseError) throw cruiseError;
  if (!cruise) throw new Error('크루즈 상세 정보를 찾을 수 없습니다.');
  return cruise;
}

export async function POST(request) {
  try {
    const { database } = await operatorContext(request);
    const body = await request.json();
    const action = String(body.action || '');
    const documentType = String(body.documentType || 'boarding_code');
    const userId = String(body.userId || '');
    const reservationId = String(body.reservationId || '');
    if (!DOCUMENT_TYPES.has(documentType) || !userId || !reservationId) throw new Error('예약과 서류 정보를 확인해 주세요.');
    await reservationContext(database, userId, reservationId);
    const folder = documentType === 'boarding_code' ? 'boarding-codes' : 'passports';

    if (action === 'prepare-upload') {
      const contentType = String(body.contentType || '');
      if (!IMAGE_TYPES.has(contentType)) throw new Error('JPG·PNG·WebP 이미지만 등록할 수 있습니다.');
      const path = `documents/${folder}/${userId}/${reservationId}/${randomUUID()}.${contentType.split('/')[1]}`;
      return Response.json({ path: `r2:${path}`, uploadUrl: await createR2UploadUrl(path, contentType, PRIVATE_CACHE_CONTROL) });
    }

    if (action === 'complete-upload') {
      const path = markerPath(body.path);
      const prefix = `documents/${folder}/${userId}/${reservationId}/`;
      if (!isPrivateR2ImagePath(path) || !path.startsWith(prefix)) throw new Error('업로드 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
      await assertR2Object(path);
      const { data, error } = await database.from('cruise_document').insert({ user_id: userId, reservation_id: reservationId, document_type: documentType, image_data: `r2:${path}` }).select('id,reservation_id,document_type,image_data,created_at,checkout_date').single();
      if (error) throw error;
      return Response.json({ document: { ...data, image_url: await createR2DownloadUrl(path, 300) } });
    }
    throw new Error('지원하지 않는 요청입니다.');
  } catch (error) {
    return errorResponse(error, /로그인/.test(error.message || '') ? 401 : 400);
  }
}
