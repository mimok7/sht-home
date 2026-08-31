import { getPlatformCartOwner, getPlatformUserDatabase } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPE_TABLES = {
  cruise: ['reservation_cruise'],
  airport: ['reservation_airport'],
  hotel: ['reservation_hotel'],
  rentcar: ['reservation_rentcar'],
  tour: ['reservation_tour'],
  ticket: ['reservation_ticket'],
  car: ['reservation_cruise_car'],
  cruise_car: ['reservation_cruise_car'],
  package: ['reservation_package', 'reservation_airport', 'reservation_rentcar', 'reservation_tour', 'reservation_hotel', 'reservation_car_sht'],
};

const FIELD_CONFIG = {
  reservation_cruise: [
    { key: 'connecting_room', label: '커넥팅룸 신청', type: 'boolean' },
    { key: 'birthday_event', label: '생일 이벤트 신청', type: 'boolean' },
    { key: 'birthday_name', label: '생일 당사자 영문성함', type: 'text' },
    { key: 'request_note', label: '요청사항', type: 'textarea' },
  ],
  reservation_airport: [
    { key: 'ra_airport_location', label: '공항', type: 'text' },
    { key: 'ra_datetime', label: '항공편 도착·출발 일시', type: 'datetime-local' },
    { key: 'ra_flight_number', label: '항공편명', type: 'text' },
    { key: 'accommodation_info', label: '숙소·승하차 장소', type: 'text' },
    { key: 'ra_stopover_location', label: '경유지', type: 'text', optional: true },
    { key: 'ra_stopover_wait_minutes', label: '경유 대기 시간(분)', type: 'number', optional: true },
    { key: 'request_note', label: '요청사항', type: 'textarea', optional: true },
  ],
  reservation_rentcar: [
    { key: 'pickup_datetime', label: '픽업 일시', type: 'datetime-local' },
    { key: 'pickup_location', label: '픽업 장소', type: 'text' },
    { key: 'destination', label: '목적지', type: 'text' },
    { key: 'via_location', label: '경유지', type: 'text', optional: true },
    { key: 'via_waiting', label: '경유 대기', type: 'text', optional: true },
    { key: 'return_datetime', label: '귀환 일시', type: 'datetime-local', returnOnly: true },
    { key: 'return_pickup_location', label: '귀환 출발지', type: 'text', returnOnly: true },
    { key: 'return_destination', label: '귀환 목적지', type: 'text', returnOnly: true },
    { key: 'return_via_location', label: '귀환 경유지', type: 'text', returnOnly: true, optional: true },
    { key: 'return_via_waiting', label: '귀환 경유 대기', type: 'text', returnOnly: true, optional: true },
    { key: 'request_note', label: '요청사항', type: 'textarea', optional: true },
  ],
  reservation_cruise_car: [
    { key: 'pickup_datetime', label: '픽업 일시', type: 'datetime-local' },
    { key: 'pickup_location', label: '픽업 장소', type: 'text' },
    { key: 'dropoff_location', label: '하차 장소', type: 'text' },
    { key: 'return_datetime', label: '귀환 일시', type: 'datetime-local', returnOnly: true },
    { key: 'request_note', label: '요청사항', type: 'textarea', optional: true },
  ],
  reservation_tour: [
    { key: 'pickup_location', label: '픽업 장소', type: 'text' },
    { key: 'dropoff_location', label: '하차 장소', type: 'text' },
    { key: 'request_note', label: '추가 요청사항', type: 'textarea', optional: true },
  ],
  reservation_hotel: [
    { key: 'accommodation_info', label: '숙박 운영정보', type: 'text', optional: true },
    { key: 'request_note', label: '요청사항', type: 'textarea', optional: true },
  ],
  reservation_ticket: [
    { key: 'pickup_location', label: '셔틀 픽업 장소', type: 'text', shuttleOnly: true },
    { key: 'dropoff_location', label: '셔틀 하차 장소', type: 'text', shuttleOnly: true },
    { key: 'program_selection', label: '메뉴·프로그램 상세', type: 'text', optional: true },
    { key: 'ticket_details', label: '티켓 이용 상세', type: 'text', optional: true },
    { key: 'special_requests', label: '추가 요청사항', type: 'textarea', optional: true },
  ],
  reservation_package: [
    { key: 'sht_pickup_vehicle', label: '승선 차량', type: 'text', optional: true },
    { key: 'sht_pickup_seat', label: '승선 좌석', type: 'text', optional: true },
    { key: 'sht_dropoff_vehicle', label: '하선 차량', type: 'text', optional: true },
    { key: 'sht_dropoff_seat', label: '하선 좌석', type: 'text', optional: true },
    { key: 'additional_requests', label: '패키지 요청사항', type: 'textarea', optional: true },
  ],
  reservation_car_sht: [
    { key: 'pickup_location', label: '셔틀 픽업 장소', type: 'text' },
    { key: 'dropoff_location', label: '셔틀 하차 장소', type: 'text' },
    { key: 'request_note', label: '요청사항', type: 'textarea', optional: true },
  ],
};

const TABLE_LABEL = {
  reservation_cruise: '크루즈',
  reservation_airport: '공항 이동',
  reservation_rentcar: '렌터카',
  reservation_cruise_car: '크루즈 차량',
  reservation_tour: '투어',
  reservation_hotel: '호텔',
  reservation_ticket: '티켓',
  reservation_package: '패키지',
  reservation_car_sht: '패키지 셔틀',
};

function fail(message, status = 400) {
  return Response.json({ error: message }, { status });
}

function isEmpty(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function fieldReference(table, rowId, key) {
  return `${table}:${rowId}:${key}`;
}

function canSetField(field, value, reference, reservation) {
  if (isEmpty(value)) return true;
  const isVersionTwo = Number(reservation.price_breakdown?.contract_version) === 2;
  const completed = new Set(reservation.price_breakdown?.operational_details_fields || []);
  return isVersionTwo && field.type === 'boolean' && value === false && !completed.has(reference);
}

function isPaid(reservation, payments) {
  return ['completed', 'paid'].includes(String(reservation.payment_status || '').toLowerCase())
    || payments.some((payment) => ['completed', 'paid'].includes(String(payment.payment_status || '').toLowerCase()));
}

function fieldsForRow(table, row) {
  return (FIELD_CONFIG[table] || []).filter((field) => {
    if (field.returnOnly && String(row.way_type || '') === '편도') return false;
    if (field.shuttleOnly && !row.shuttle_required) return false;
    if (table === 'reservation_cruise' && field.key !== 'request_note' && row.__index > 0) return false;
    return Object.prototype.hasOwnProperty.call(row, field.key);
  });
}

function groupTitle(table, row, index) {
  if (table === 'reservation_airport') return `${TABLE_LABEL[table]} · ${String(row.way_type || '').toLowerCase() === 'sending' ? '샌딩' : '픽업'}`;
  if (table === 'reservation_car_sht') return `${TABLE_LABEL[table]} · ${String(row.sht_category || '').toLowerCase().includes('drop') ? '하선' : '승선'}`;
  return `${TABLE_LABEL[table] || table}${index > 0 ? ` ${index + 1}` : ''}`;
}

function normalizeValue(field, value) {
  if (field.type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${field.label} 값이 올바르지 않습니다.`);
  }
  if (field.type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field.label} 값을 확인해 주세요.`);
    return Math.trunc(parsed);
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 1000) throw new Error(`${field.label} 값이 너무 깁니다.`);
  if (field.type === 'datetime-local') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw new Error(`${field.label} 형식을 확인해 주세요.`);
    return `${text}:00+09:00`;
  }
  return text;
}

async function loadContext(request, id) {
  const owner = await getPlatformCartOwner(request);
  const platform = getPlatformUserDatabase(request);
  if (!owner || !platform) return { error: fail('플랫폼 로그인이 필요합니다.', 401) };
  const reservationResult = await platform.from('reservation').select('re_id,re_type,re_status,re_user_id,reservation_date,payment_status,price_breakdown').eq('re_id', id).eq('re_user_id', owner.id).maybeSingle();
  if (reservationResult.error) return { error: fail('예약을 확인하지 못했습니다.', 500) };
  if (!reservationResult.data) return { error: fail('예약을 찾을 수 없습니다.', 404) };
  const paymentResult = await platform.from('reservation_payment').select('payment_status').eq('reservation_id', id);
  if (paymentResult.error) return { error: fail('결제 상태를 확인하지 못했습니다.', 500) };
  return { owner, platform, reservation: reservationResult.data, paid: isPaid(reservationResult.data, paymentResult.data || []) };
}

export async function GET(request, { params }) {
  const { id } = await params;
  const context = await loadContext(request, id);
  if (context.error) return context.error;
  const { platform, reservation, paid } = context;
  const tables = TYPE_TABLES[reservation.re_type] || [];
  const groups = [];
  for (const table of tables) {
    const result = await platform.from(table).select('*').eq('reservation_id', id).order('created_at', { ascending: true });
    if (result.error) return fail(`${TABLE_LABEL[table] || '서비스'} 운영정보를 불러오지 못했습니다.`, 500);
    (result.data || []).forEach((sourceRow, index) => {
      const row = { ...sourceRow, __index: index };
      const fields = fieldsForRow(table, row).map((field) => {
        const reference = fieldReference(table, row.id, field.key);
        return { ...field, value: row[field.key] ?? '', locked: !canSetField(field, row[field.key], reference, reservation) };
      });
      if (fields.length) groups.push({ table, rowId: row.id, title: groupTitle(table, row, index), fields });
    });
  }
  return Response.json({ reservation: { id: reservation.re_id, type: reservation.re_type, status: reservation.re_status, reservationDate: reservation.reservation_date }, paid, groups });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const context = await loadContext(request, id);
  if (context.error) return context.error;
  const { platform, reservation, paid } = context;
  if (!paid) return fail('결제 완료 후 운영정보를 입력할 수 있습니다.', 403);

  const body = await request.json().catch(() => null);
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (!updates.length || updates.length > 30) return fail('저장할 운영정보를 확인해 주세요.');
  const allowedTables = new Set(TYPE_TABLES[reservation.re_type] || []);
  const pending = [];
  const completedFields = new Set(reservation.price_breakdown?.operational_details_fields || []);

  for (const update of updates) {
    if (!allowedTables.has(update.table) || !update.rowId || !update.values || typeof update.values !== 'object') return fail('허용되지 않은 운영정보 요청입니다.');
    const rowResult = await platform.from(update.table).select('*').eq('id', update.rowId).eq('reservation_id', id).maybeSingle();
    if (rowResult.error || !rowResult.data) return fail('운영정보 대상 행을 확인하지 못했습니다.', 404);
    const row = { ...rowResult.data, __index: 0 };
    const fieldMap = new Map(fieldsForRow(update.table, row).map((field) => [field.key, field]));
    const payload = {};
    for (const [key, rawValue] of Object.entries(update.values)) {
      const field = fieldMap.get(key);
      if (!field) return fail('허용되지 않은 운영정보 항목이 포함되어 있습니다.');
      const value = normalizeValue(field, rawValue);
      if (value === null) continue;
      const reference = fieldReference(update.table, update.rowId, key);
      if (!canSetField(field, row[key], reference, reservation)) return fail(`${field.label}은 이미 등록되어 기존 플랫폼 변경요청으로 수정해야 합니다.`, 409);
      payload[key] = value;
      completedFields.add(reference);
    }
    if (Object.keys(payload).length) pending.push({ table: update.table, rowId: update.rowId, payload });
  }

  if (!pending.length) return fail('새로 입력한 운영정보가 없습니다.');
  for (const update of pending) {
    const result = await platform.from(update.table).update(update.payload).eq('id', update.rowId).eq('reservation_id', id).select('id').maybeSingle();
    if (result.error || !result.data) return fail('운영정보를 저장하지 못했습니다.', 500);
  }

  const nextBreakdown = { ...(reservation.price_breakdown || {}), operational_details_status: 'submitted', operational_details_submitted_at: new Date().toISOString(), operational_details_fields: [...completedFields] };
  await platform.from('reservation').update({ price_breakdown: nextBreakdown }).eq('re_id', id).eq('re_user_id', context.owner.id);
  return Response.json({ saved: true, updatedRows: pending.length });
}
