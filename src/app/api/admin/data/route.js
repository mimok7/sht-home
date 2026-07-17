// 플랫폼 운영자 권한을 검증해 홈페이지용 v2 데이터를 안전하게 관리하는 API다.
import { randomUUID } from 'node:crypto';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_UNITS = new Set(['per_adult', 'per_person', 'per_room', 'per_vehicle', 'unknown']);
const SCHEDULE_TYPES = new Set(['DAY', '1N2D', '2N3D']);

function errorResponse(error, fallback = '관리자 데이터를 처리하지 못했습니다.') {
  console.error('[homepage-admin]', error?.message || error);
  return Response.json({ error: fallback }, { status: 500 });
}

function nullableText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function nullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number === null || Number.isInteger(number) ? number : null;
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}

function todayIso() {
  return new Date().toISOString();
}

async function getUnmatchedRateCruises(database) {
  const [rates, aliases, cruises] = await Promise.all([
    database.from('cruise_rate_card').select('cruise_name,schedule_type').in('schedule_type', [...SCHEDULE_TYPES]),
    database.from('cruise_aliases_v2').select('alias'),
    database.from('cruises_v2').select('legacy_name'),
  ]);
  const failed = [rates, aliases, cruises].find((result) => result.error);
  if (failed) throw failed.error;

  const knownNames = new Set([
    ...(aliases.data || []).map((row) => row.alias),
    ...(cruises.data || []).map((row) => row.legacy_name),
  ]);
  const grouped = new Map();
  for (const rate of rates.data || []) {
    const name = rate.cruise_name?.trim();
    if (!name || knownNames.has(name)) continue;
    const item = grouped.get(name) || { legacy_name: name, rate_count: 0, schedule_types: new Set() };
    item.rate_count += 1;
    item.schedule_types.add(rate.schedule_type);
    grouped.set(name, item);
  }
  return [...grouped.values()]
    .map((item) => ({ ...item, schedule_types: [...item.schedule_types].sort() }))
    .sort((left, right) => left.legacy_name.localeCompare(right.legacy_name, 'ko'));
}

async function getDashboard(database, role) {
  const queries = [
    database.from('cruises_v2').select('id,slug,code,name_ko,name_en,description,category,star_rating,hero_image,is_active,updated_at').order('name_ko'),
    database.from('cruise_itineraries_v2').select('id,cruise_id,schedule_type,nights,description,is_active').order('schedule_type'),
    database.from('cabins_v2').select('id,cruise_id,name_ko,name_en,image_url,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,is_active').order('name_ko'),
    database.from('cabin_images_v2').select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at').order('sort_order'),
    database.from('rate_plans_v2').select('id,cabin_id,itinerary_id,valid_during,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,extra_bed_available,season_name,is_active').order('created_at'),
    database.from('cruise_tags_v2').select('cruise_id,tag,evidence,is_active').order('tag'),
    database.from('catalog_products_v2').select('id,service_type,source,source_key,name_ko,description,category,image_url,metadata,source_updated_at,is_active,manual_override,updated_at').eq('source', 'sht-platform').order('name_ko'),
    database.from('catalog_prices_v2').select('id,product_id,source_table,source_id,label,price_amount,currency,price_unit,min_guests,max_guests,valid_from,valid_to,metadata,source_updated_at,is_active,manual_override,updated_at').eq('source', 'sht-platform').order('source_table'),
  ];
  if (role === 'admin') {
    queries.push(
      database.from('member_profiles').select('id,email,display_name,phone,role_id,status,created_at').order('created_at', { ascending: false }),
      database.from('member_roles').select('id,label,description,permissions').order('id'),
    );
  }
  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;

  const [cruises, itineraries, cabins, cabinImages, rates, tags, catalogProducts, catalogPrices, members, roles] = results;
  return {
    cruises: (cruises.data || []).sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko')),
    itineraries: itineraries.data || [],
    cabins: cabins.data || [],
    cabinImages: cabinImages.data || [],
    rates: rates.data || [],
    tags: tags.data || [],
    catalogProducts: (catalogProducts.data || []).sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko')),
    catalogPrices: catalogPrices.data || [],
    members: members?.data || [],
    roles: roles?.data || [],
    unmatchedRates: await getUnmatchedRateCruises(database),
  };
}

async function updateCatalogProduct(database, id, values) {
  const name = nullableText(values.name_ko);
  if (!name || typeof values.is_active !== 'boolean') throw new Error('상품명과 공개 상태를 확인해 주세요.');
  const allowed = {
    name_ko: name,
    description: nullableText(values.description),
    category: nullableText(values.category),
    image_url: nullableText(values.image_url),
    is_active: values.is_active,
  };
  const { data: current, error: currentError } = await database
    .from('catalog_products_v2')
    .select('manual_override')
    .eq('id', id)
    .eq('source', 'sht-platform')
    .single();
  if (currentError) throw currentError;
  const { error } = await database
    .from('catalog_products_v2')
    .update({ manual_override: { ...(current.manual_override || {}), ...allowed }, updated_at: todayIso() })
    .eq('id', id);
  if (error) throw error;
}

async function updateCatalogPrice(database, id, values) {
  const priceUnit = values.price_unit;
  const currency = nullableText(values.currency)?.toUpperCase();
  const minGuests = nullableInteger(values.min_guests);
  const maxGuests = nullableInteger(values.max_guests);
  if (!PRICE_UNITS.has(priceUnit) || !currency || typeof values.is_active !== 'boolean' || (minGuests !== null && minGuests < 1) || (maxGuests !== null && maxGuests < 1) || (minGuests !== null && maxGuests !== null && minGuests > maxGuests)) {
    throw new Error('요금 단위, 통화, 인원 범위를 확인해 주세요.');
  }
  const allowed = {
    label: nullableText(values.label),
    price_amount: nullableNumber(values.price_amount),
    currency,
    price_unit: priceUnit,
    min_guests: minGuests,
    max_guests: maxGuests,
    valid_from: nullableText(values.valid_from),
    valid_to: nullableText(values.valid_to),
    is_active: values.is_active,
  };
  if (allowed.valid_from && allowed.valid_to && allowed.valid_from > allowed.valid_to) throw new Error('요금 적용 종료일은 시작일 이후여야 합니다.');
  const { data: current, error: currentError } = await database
    .from('catalog_prices_v2')
    .select('manual_override')
    .eq('id', id)
    .eq('source', 'sht-platform')
    .single();
  if (currentError) throw currentError;
  const { error } = await database
    .from('catalog_prices_v2')
    .update({ manual_override: { ...(current.manual_override || {}), ...allowed }, updated_at: todayIso() })
    .eq('id', id);
  if (error) throw error;
}

async function createRateOnlyCruise(database, source) {
  const suffix = randomUUID().slice(0, 8);
  const { data: created, error: createError } = await database
    .from('cruises_v2')
    .insert({ legacy_name: source.legacy_name, name_ko: source.legacy_name, slug: `manual-${suffix}`, code: `MANUAL-${suffix.toUpperCase()}`, is_active: false })
    .select('id')
    .single();
  if (createError) throw createError;
  const scheduleRows = (source.schedule_types || [])
    .filter((scheduleType) => SCHEDULE_TYPES.has(scheduleType))
    .map((scheduleType) => ({ cruise_id: created.id, schedule_type: scheduleType, nights: scheduleType === 'DAY' ? 0 : scheduleType === '1N2D' ? 1 : 2, is_active: false }));
  const [aliasResult, itineraryResult] = await Promise.all([
    database.from('cruise_aliases_v2').upsert({ alias: source.legacy_name, cruise_id: created.id }),
    scheduleRows.length ? database.from('cruise_itineraries_v2').insert(scheduleRows) : Promise.resolve({ error: null }),
  ]);
  if (aliasResult.error || itineraryResult.error) throw aliasResult.error || itineraryResult.error;
  return created.id;
}

async function mutate(database, operator, body) {
  const { action, id, values } = body || {};
  if (action === 'updateCatalogProduct') return updateCatalogProduct(database, id, values || {});
  if (action === 'updateCatalogPrice') return updateCatalogPrice(database, id, values || {});
  if (action === 'createRateOnlyCruise') return { createdCruiseId: await createRateOnlyCruise(database, values || {}) };
  if (action === 'updateCruise') {
    const { error } = await database.from('cruises_v2').update({ ...pick(values || {}, ['name_ko', 'name_en', 'description', 'category', 'star_rating', 'hero_image', 'is_active']), updated_at: todayIso() }).eq('id', id);
    if (error) throw error;
    return null;
  }
  if (action === 'upsertCruiseTag') {
    const { error } = await database.from('cruise_tags_v2').upsert({ cruise_id: id, tag: values?.tag, evidence: nullableText(values?.evidence), is_active: Boolean(values?.is_active) }, { onConflict: 'cruise_id,tag' });
    if (error) throw error;
    return null;
  }
  if (action === 'updateItinerary') {
    const { error } = await database.from('cruise_itineraries_v2').update({ description: nullableText(values?.description), is_active: Boolean(values?.is_active), updated_at: todayIso() }).eq('id', id);
    if (error) throw error;
    return null;
  }
  if (action === 'updateCabin') {
    const fields = pick(values || {}, ['name_ko', 'name_en', 'image_url', 'room_area_text', 'bed_type', 'max_adults', 'max_guests', 'has_balcony', 'is_vip', 'has_butler', 'is_recommended', 'connecting_available', 'extra_bed_available', 'facilities', 'special_amenities', 'is_active']);
    const { error } = await database.from('cabins_v2').update({ ...fields, updated_at: todayIso() }).eq('id', id);
    if (error) throw error;
    return null;
  }
  if (action === 'updateRate') {
    const fields = pick(values || {}, ['valid_during', 'price_basis', 'price_adult', 'price_child', 'price_infant', 'price_single', 'price_extra_bed', 'season_name', 'single_available', 'extra_bed_available', 'is_active']);
    const { error } = await database.from('rate_plans_v2').update({ ...fields, updated_at: todayIso() }).eq('id', id);
    if (error) throw error;
    return null;
  }
  if (operator.role !== 'admin') throw new Error('회원과 권한은 관리자만 변경할 수 있습니다.');
  if (action === 'updateMember') {
    const { error } = await database.from('member_profiles').update(pick(values || {}, ['role_id', 'status'])).eq('id', id);
    if (error) throw error;
    return null;
  }
  if (action === 'updateMemberRole') {
    const { error } = await database.from('member_roles').update({ permissions: values?.permissions || {} }).eq('id', id);
    if (error) throw error;
    return null;
  }
  throw new Error('지원하지 않는 관리자 작업입니다.');
}

export async function GET(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 });
  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    return Response.json({ ok: true, operator, data: await getDashboard(database, operator.role) });
  } catch (error) {
    return errorResponse(error, '관리자 데이터를 불러오지 못했습니다.');
  }
}

export async function PATCH(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 });
  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  try {
    const body = await request.json();
    const result = await mutate(database, operator, body);
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = /확인해 주세요|이후여야|관리자만/.test(error?.message || '') ? 400 : 500;
    if (status === 400) return Response.json({ error: error.message }, { status });
    return errorResponse(error, '변경 사항을 저장하지 못했습니다.');
  }
}
