// 플랫폼 운영자 권한을 검증해 홈페이지용 v2 데이터를 안전하게 관리하는 API다.
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCHEDULE_TYPES = new Set(['DAY', '1N2D', '2N3D']);
const PLATFORM_PRODUCT_ACTIONS = new Set([
  'updateCatalogProduct', 'updateCatalogPrice', 'updateCatalogDetails', 'createRateOnlyCruise',
  'updateCruise', 'updateItinerary', 'updateCabin', 'createCabin', 'updateRate',
  'upsertCruiseTag',
]);
const CRUISE_CACHE_FIELDS = ['name_ko', 'name_en', 'description', 'star_rating', 'hero_image', 'is_active'];
const ITINERARY_CACHE_FIELDS = ['description', 'is_active'];

function recommendationTag(value) {
  const tag = nullableText(value)?.toLowerCase();
  return tag && /^[a-z][a-z0-9-]{0,39}$/.test(tag) ? tag : null;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function cruiseSource(database, cruiseId) {
  const { data, error } = await database.from('cruises_v2').select('legacy_name,name_ko').eq('id', cruiseId).maybeSingle();
  if (error) throw error;
  const cruiseName = data?.legacy_name || data?.name_ko;
  if (!cruiseName) throw new Error('플랫폼 크루즈 원본을 찾을 수 없습니다.');
  return { cruiseName };
}

async function platformMutationSource(database, action, id, values) {
  if (action === 'createRateOnlyCruise') return { cruiseName: nullableText(values?.legacy_name) };
  if (action === 'updateCruise' || action === 'createCabin' || action === 'upsertCruiseTag') return cruiseSource(database, id);
  if (action === 'updateItinerary') {
    const { data, error } = await database.from('cruise_itineraries_v2').select('cruise_id,schedule_type').eq('id', id).maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 일정 원본을 찾을 수 없습니다.');
    return { ...(await cruiseSource(database, data.cruise_id)), scheduleType: data.schedule_type };
  }
  if (action === 'updateCabin') {
    const { data, error } = await database.from('cabins_v2').select('cruise_id,legacy_room_name,name_ko').eq('id', id).maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 객실 원본을 찾을 수 없습니다.');
    return { ...(await cruiseSource(database, data.cruise_id)), roomName: data.legacy_room_name || data.name_ko };
  }
  if (action === 'updateRate') {
    const { data, error } = await database.from('rate_plans_v2').select('source_rate_id').eq('id', id).maybeSingle();
    if (error || !data?.source_rate_id) throw error || new Error('플랫폼 요금 원본을 찾을 수 없습니다.');
    return { sourceId: String(data.source_rate_id) };
  }
  if (action === 'updateCatalogProduct' || action === 'updateCatalogDetails') {
    const { data, error } = await database.from('catalog_products_v2').select('service_type,source_key').eq('id', id).eq('source', 'sht-platform').maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 상품 원본을 찾을 수 없습니다.');
    return { serviceType: data.service_type, sourceKey: data.source_key };
  }
  if (action === 'updateCatalogPrice') {
    const { data, error } = await database.from('catalog_prices_v2').select('source_table,source_id').eq('id', id).eq('source', 'sht-platform').maybeSingle();
    if (error || !data) throw error || new Error('플랫폼 요금 원본을 찾을 수 없습니다.');
    return { sourceTable: data.source_table, sourceId: String(data.source_id) };
  }
  throw new Error('지원하지 않는 플랫폼 상품 작업입니다.');
}

async function sendPlatformMutation(token, source, body) {
  const platformAdminUrl = process.env.PLATFORM_ADMIN_URL || process.env.NEXT_PUBLIC_PLATFORM_ADMIN_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3004' : 'https://admin.stayhalong.com');
  const response = await fetch(`${platformAdminUrl.replace(/\/$/, '')}/api/admin/homepage-product-write`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: body.action, source, values: body.values || {} }),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '플랫폼 DB 저장에 실패했습니다.');
  return result;
}

async function forwardPlatformMutation(request, database, body) {
  const source = await platformMutationSource(database, body.action, body.id, body.values || {});
  const result = await sendPlatformMutation(bearerToken(request), source, body);
  await mirrorCruiseUpdate(database, body);
  await mirrorCatalogProductUpdate(database, body);
  return result;
}

async function updateCruiseImmediately(request, database, body) {
  const source = await platformMutationSource(database, body.action, body.id, body.values || {});
  const token = bearerToken(request);
  await mirrorCruiseUpdate(database, body);

  after(async () => {
    try {
      await sendPlatformMutation(token, source, body);
    } catch (error) {
      console.error('[homepage-admin] delayed platform sync failed', error?.message || error);
    }
  });

  return { ok: true, syncPending: true };
}

async function updateItineraryImmediately(request, database, body) {
  const source = await platformMutationSource(database, body.action, body.id, body.values || {});
  const token = bearerToken(request);
  await mirrorItineraryUpdate(database, body);

  after(async () => {
    try {
      await sendPlatformMutation(token, source, body);
    } catch (error) {
      console.error('[homepage-admin] delayed itinerary sync failed', error?.message || error);
    }
  });

  return { ok: true, syncPending: true };
}

// 플랫폼이 원본이지만, 공개 상태 변경은 다음 전체 동기화를 기다리지 않고
// 홈페이지의 공개 목록에 즉시 반영한다. 이후 동기화도 플랫폼의 같은 값을 다시 적용한다.
async function mirrorCruiseUpdate(database, body) {
  if (body?.action === 'upsertCruiseTag' && body.id) {
    const tag = recommendationTag(body.values?.tag);
    const evidence = nullableText(body.values?.evidence);
    if (!tag || !evidence) throw new Error('추천 태그와 근거를 확인해 주세요.');
    const { error } = await database.from('cruise_tags_v2').upsert({ cruise_id: body.id, tag, evidence, is_active: Boolean(body.values?.is_active) }, { onConflict: 'cruise_id,tag' });
    if (error) throw error;
    revalidatePath('/travel-guide');
    revalidatePath('/cruises');
    revalidatePath('/product/[id]', 'page');
    return;
  }
  if (body?.action !== 'updateCruise' || !body.id) return;
  const values = pick(body.values || {}, CRUISE_CACHE_FIELDS);
  if (!Object.keys(values).length) return;

  const { error } = await database
    .from('cruises_v2')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', body.id);
  if (error) throw error;

  revalidatePath('/cruises');
  revalidatePath('/temp-home');
  revalidatePath('/product/[id]', 'page');
}

// 호텔 등 일반 서비스의 상품 설명도 플랫폼 동기화 경고와 관계없이 즉시 공개 카탈로그에 반영한다.
// 플랫폼은 같은 값을 오버라이드로 보관하므로, 다음 전체 동기화에서도 이 값이 다시 적용된다.
async function mirrorCatalogProductUpdate(database, body) {
  if (body?.action !== 'updateCatalogProduct' || !body.id) return;
  const values = body.values || {};
  const updates = { updated_at: new Date().toISOString() };
  if (Object.hasOwn(values, 'name_ko')) updates.name_ko = nullableText(values.name_ko);
  if (Object.hasOwn(values, 'description')) updates.description = nullableText(values.description);
  if (Object.hasOwn(values, 'category')) updates.category = nullableText(values.category);
  if (Object.hasOwn(values, 'image_url')) updates.image_url = nullableText(values.image_url);
  if (Object.hasOwn(values, 'is_active')) updates.is_active = Boolean(values.is_active);
  if (Object.keys(updates).length === 1) return;

  const { error } = await database.from('catalog_products_v2').update(updates).eq('id', body.id).eq('source', 'sht-platform');
  if (error) throw error;

  revalidatePath('/');
  revalidatePath('/hotels');
  revalidatePath('/hotels/[id]', 'page');
  revalidatePath('/travel-guide');
  revalidatePath('/temp-home');
}

// 일정 저장은 플랫폼의 전체 카탈로그 동기화를 기다리지 않고 공개 화면에 즉시 반영한다.
async function mirrorItineraryUpdate(database, body) {
  if (body?.action !== 'updateItinerary' || !body.id) return;
  const values = pick(body.values || {}, ITINERARY_CACHE_FIELDS);
  if (!Object.keys(values).length) return;

  const { data, error } = await database
    .from('cruise_itineraries_v2')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('수정할 일정을 찾을 수 없습니다.');

  revalidatePath('/cruises');
  revalidatePath('/product/[id]', 'page');
}

function errorResponse(error, fallback = '관리자 데이터를 처리하지 못했습니다.') {
  console.error('[homepage-admin]', error?.message || error);
  return Response.json({ error: fallback }, { status: 500 });
}

function nullableText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
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
    database.from('cruises_v2').select('id,slug,code,legacy_name,name_ko,name_en,description,category,star_rating,hero_image,is_active,updated_at').order('name_ko'),
    database.from('cruise_itineraries_v2').select('id,cruise_id,schedule_type,nights,description,is_active').order('schedule_type'),
    database.from('cabins_v2').select('id,cruise_id,name_ko,name_en,image_url,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,is_active').order('name_ko'),
    database.from('cabin_images_v2').select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at').order('sort_order'),
    database.from('cruise_cafe_import_images_v2').select('id,cruise_id,cabin_id,storage_bucket,storage_path,image_name,sort_order,is_primary,created_at').order('sort_order'),
    database.from('rate_plans_v2').select('id,cabin_id,itinerary_id,valid_during,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,extra_bed_available,season_name,is_active').order('created_at'),
    database.from('cruise_tags_v2').select('cruise_id,tag,evidence,is_active').order('tag'),
    database.from('catalog_products_v2').select('id,service_type,source,source_key,name_ko,description,category,image_url,metadata,source_updated_at,is_active,manual_override,updated_at').eq('source', 'sht-platform').order('name_ko'),
    database.from('catalog_prices_v2').select('id,product_id,source_table,source_id,label,price_amount,currency,price_unit,min_guests,max_guests,valid_from,valid_to,metadata,source_updated_at,is_active,manual_override,updated_at').eq('source', 'sht-platform').order('source_table'),
    database.from('catalog_product_details_v2').select('product_id,source_table,source_id,payload,source_updated_at,is_active').eq('source', 'sht-platform').eq('source_table', 'hotel_price').order('source_updated_at', { ascending: false }),
    database.from('catalog_product_details_v2').select('product_id,source_table,source_id,payload,source_updated_at,is_active').eq('source', 'sht-platform').order('source_updated_at', { ascending: false }),
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

  const [cruises, itineraries, cabins, cabinImages, cruiseImages, rates, tags, catalogProducts, catalogPrices, hotelRoomDetails, serviceDetails, members, roles] = results;
  // 호텔 이미지 테이블은 별도 마이그레이션으로 도입되었다. PostgREST 스키마
  // 캐시가 아직 갱신되지 않은 경우에도 기본 관리자 화면이 멈추지 않도록
  // 갤러리만 빈 목록으로 처리한다.
  const hotelImagesResult = await database.from('hotel_gallery_images_v2').select('id,product_id,hotel_price_code,collection,image_name,image_url,sort_order,is_primary,created_at').order('sort_order');
  if (hotelImagesResult.error) console.warn('[homepage-admin] 호텔 갤러리 조회 생략', hotelImagesResult.error.message);
  const serviceTagsResult = await database.from('service_tags_v2').select('product_id,tag,evidence,is_active').order('tag');
  if (serviceTagsResult.error) console.warn('[homepage-admin] 서비스 추천 태그 조회 생략', serviceTagsResult.error.message);
  return {
    cruises: (cruises.data || []).sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko')),
    itineraries: itineraries.data || [],
    cabins: cabins.data || [],
    cabinImages: cabinImages.data || [],
    cruiseImages: cruiseImages.data || [],
    rates: rates.data || [],
    tags: tags.data || [],
    catalogProducts: (catalogProducts.data || []).sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko')),
    catalogPrices: catalogPrices.data || [],
    hotelRoomDetails: hotelRoomDetails.data || [],
    serviceDetails: serviceDetails.data || [],
    hotelImages: hotelImagesResult.data || [],
    serviceTags: serviceTagsResult.data || [],
    members: members?.data || [],
    roles: roles?.data || [],
    unmatchedRates: await getUnmatchedRateCruises(database),
  };
}

async function mutate(database, operator, body) {
  const { action, id, values } = body || {};
  if (action === 'upsertServiceTag') {
    const { data: product, error: productError } = await database.from('catalog_products_v2').select('id').eq('id', id).eq('source', 'sht-platform').in('service_type', ['hotel', 'airport', 'tour', 'vehicle']).maybeSingle();
    if (productError || !product) throw productError || new Error('서비스 상품을 찾을 수 없습니다.');
    const tag = recommendationTag(values?.tag);
    if (!tag) throw new Error('추천 태그는 영문 소문자, 숫자와 하이픈으로 입력해 주세요.');
    const { error } = await database.from('service_tags_v2').upsert({ product_id: id, tag, evidence: nullableText(values?.evidence) || '', is_active: Boolean(values?.is_active), updated_at: new Date().toISOString() }, { onConflict: 'product_id,tag' });
    if (error) throw error;
    revalidatePath('/');
    revalidatePath('/temp-home');
    revalidatePath('/travel-guide');
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
    if (body?.action === 'updateCruise') {
      return Response.json(await updateCruiseImmediately(request, database, body));
    }
    if (body?.action === 'updateItinerary') {
      return Response.json(await updateItineraryImmediately(request, database, body));
    }
    if (PLATFORM_PRODUCT_ACTIONS.has(body?.action)) {
      return Response.json(await forwardPlatformMutation(request, database, body));
    }
    const result = await mutate(database, operator, body);
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = /확인해 주세요|이후여야|관리자만|같은 이름|플랫폼|추천 기준|호텔 상품|서비스 상품|지원하지/.test(error?.message || '') ? 400 : 500;
    if (status === 400) return Response.json({ error: error.message }, { status });
    return errorResponse(error, '변경 사항을 저장하지 못했습니다.');
  }
}
