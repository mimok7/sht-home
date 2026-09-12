import { randomUUID } from 'node:crypto';
import { assertR2Object, createR2DownloadUrl, createR2UploadUrl, deleteR2Objects, isPrivateR2ImagePath } from '@/lib/r2-storage';
import { getHomepageDatabase, getHomepageUser } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_PREFIX = 'documents';
const PRIVATE_CACHE_CONTROL = 'private, no-store';
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function fail(error, status = 400) {
  const message = error instanceof Error ? error.message : '여행 서류를 처리하지 못했습니다.';
  return Response.json({ error: message }, { status });
}

async function context(request) {
  const user = await getHomepageUser(request);
  const database = getHomepageDatabase();
  if (!user) throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
  if (!database) throw new Error('여행 서류 저장소 설정을 확인하지 못했습니다.');
  return { user, database };
}

function r2Path(value) {
  const source = String(value || '');
  return source.startsWith('r2:') ? source.slice(3) : '';
}

function checkoutDate(checkin, scheduleType) {
  const date = new Date(checkin);
  if (Number.isNaN(date.getTime())) return null;
  const nights = Number(String(scheduleType || '').match(/\d+/)?.[0]) || 1;
  date.setUTCDate(date.getUTCDate() + nights);
  return date.toISOString().slice(0, 10);
}

async function reservationData(database, userId) {
  const { data: reservations, error: reservationError } = await database
    .from('reservation')
    .select('re_id,re_quote_id,reservation_date')
    .eq('re_user_id', userId)
    .eq('re_type', 'cruise')
    .order('reservation_date', { ascending: true });
  if (reservationError) throw reservationError;
  const reservationIds = (reservations || []).map((item) => item.re_id);
  if (!reservationIds.length) return { cruises: [], passports: [], reservationIds: [] };

  const [cruiseResult, documentResult] = await Promise.all([
    database.from('reservation_cruise').select('reservation_id,checkin,room_price_code,boarding_code').in('reservation_id', reservationIds),
    database.from('cruise_document').select('id,reservation_id,document_type,image_data,created_at,checkout_date').eq('user_id', userId).in('reservation_id', reservationIds).order('created_at', { ascending: false }),
  ]);
  if (cruiseResult.error) throw cruiseResult.error;
  if (documentResult.error) throw documentResult.error;

  const roomCodes = [...new Set((cruiseResult.data || []).map((item) => item.room_price_code).filter(Boolean))];
  let rateById = new Map();
  if (roomCodes.length) {
    const { data: rates, error: rateError } = await database.from('cruise_rate_card').select('id,cruise_name,room_type,schedule_type').in('id', roomCodes);
    if (rateError) throw rateError;
    rateById = new Map((rates || []).map((item) => [item.id, item]));
  }

  const documents = await Promise.all((documentResult.data || []).map(async (item) => {
    const path = r2Path(item.image_data);
    const imageUrl = path && isPrivateR2ImagePath(path)
      ? await createR2DownloadUrl(path, 300)
      : item.image_data;
    return { ...item, image_url: imageUrl };
  }));
  return {
    passports: documents.filter((item) => item.document_type === 'passport'),
    reservationIds,
    cruises: (cruiseResult.data || []).map((item) => ({
      ...item,
      reservation: (reservations || []).find((reservation) => reservation.re_id === item.reservation_id),
      rate: rateById.get(item.room_price_code),
      boardingImages: documents.filter((document) => document.document_type === 'boarding_code' && document.reservation_id === item.reservation_id),
    })),
  };
}

async function ownedCruise(database, userId, reservationId) {
  const result = await reservationData(database, userId);
  const cruise = result.cruises.find((item) => item.reservation_id === reservationId);
  if (!cruise) throw new Error('연결된 크루즈 예약을 찾을 수 없습니다.');
  return cruise;
}

export async function GET(request) {
  try {
    const { user, database } = await context(request);
    const data = await reservationData(database, user.id);
    return Response.json({ cruises: data.cruises, passports: data.passports });
  } catch (error) {
    return fail(error, /로그인/.test(error.message || '') ? 401 : 500);
  }
}

export async function POST(request) {
  try {
    const { user, database } = await context(request);
    const body = await request.json();
    const action = String(body.action || '');

    if (action === 'prepare-passport-upload') {
      const reservationId = String(body.reservationId || '');
      const contentType = String(body.contentType || '');
      if (!ACCEPTED_IMAGE_TYPES.has(contentType)) throw new Error('JPG·PNG·WebP 이미지만 등록할 수 있습니다.');
      await ownedCruise(database, user.id, reservationId);
      const path = `${PRIVATE_PREFIX}/passports/${user.id}/${reservationId}/${randomUUID()}.${contentType.split('/')[1]}`;
      const uploadUrl = await createR2UploadUrl(path, contentType, PRIVATE_CACHE_CONTROL);
      return Response.json({ path: `r2:${path}`, uploadUrl });
    }

    if (action === 'complete-passport-upload') {
      const reservationId = String(body.reservationId || '');
      const path = r2Path(body.path);
      const expectedPrefix = `${PRIVATE_PREFIX}/passports/${user.id}/${reservationId}/`;
      if (!isPrivateR2ImagePath(path) || !path.startsWith(expectedPrefix)) throw new Error('업로드 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
      const cruise = await ownedCruise(database, user.id, reservationId);
      await assertR2Object(path);
      const { data, error } = await database.from('cruise_document').insert({
        user_id: user.id,
        reservation_id: reservationId,
        document_type: 'passport',
        image_data: `r2:${path}`,
        checkout_date: checkoutDate(cruise.checkin, cruise.rate?.schedule_type),
      }).select('id,reservation_id,document_type,image_data,created_at,checkout_date').single();
      if (error) throw error;
      return Response.json({ document: { ...data, image_url: await createR2DownloadUrl(path, 300) } });
    }

    if (action === 'delete-passports') {
      const ids = [...new Set((Array.isArray(body.documentIds) ? body.documentIds : []).map(String).filter(Boolean))];
      if (!ids.length) throw new Error('삭제할 여권을 선택해 주세요.');
      const { data: documents, error: documentError } = await database.from('cruise_document')
        .select('id,image_data')
        .eq('user_id', user.id)
        .eq('document_type', 'passport')
        .in('id', ids);
      if (documentError) throw documentError;
      if (!documents?.length) throw new Error('삭제할 여권을 찾을 수 없습니다.');
      const { error: deleteError } = await database.from('cruise_document').delete().eq('user_id', user.id).eq('document_type', 'passport').in('id', documents.map((item) => item.id));
      if (deleteError) throw deleteError;
      const paths = documents.map((item) => r2Path(item.image_data)).filter(isPrivateR2ImagePath);
      if (paths.length) await deleteR2Objects(paths);
      return Response.json({ deletedIds: documents.map((item) => item.id) });
    }

    throw new Error('지원하지 않는 요청입니다.');
  } catch (error) {
    return fail(error, /로그인/.test(error.message || '') ? 401 : 400);
  }
}
