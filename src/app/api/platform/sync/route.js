// 예약 플랫폼이 전송한 상품 원본을 홈페이지 동기화 스테이징 테이블에 저장한다.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { syncPlatformCruiseV2, syncPlatformHotelImagesV2 } from '@/lib/sync-platform-cruise-v2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE_TABLES = new Set([
  'cruise_info', 'cruise_rate_card', 'cruise_rate_card_inclusions', 'cruise_location', 'cruise_promotion',
  'cruise_promotion_rate', 'cruise_holiday_surcharge', 'cruise_tour_options', 'cruise_info_by_category',
  'cruise_info_view', 'cruise_rooms_view', 'hotel_info', 'hotel_price', 'airport_name', 'airport_price',
  'tour', 'tour_pricing', 'tour_schedule', 'tour_inclusions', 'tour_exclusions', 'tour_important_info',
  'tour_addon_options', 'tour_payment_pricing', 'tour_cancellation_policy', 'tour_cruise_integration', 'rentcar_price',
  'homepage_cruise_content', 'homepage_cruise_itineraries', 'homepage_cruise_tags', 'homepage_cruise_images',
  'homepage_cruise_cabin_overrides', 'homepage_hotel_images',
  'homepage_catalog_product_overrides', 'homepage_catalog_price_overrides',
]);

function chunks(values, size = 200) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function removeDeletedSourceRows(database, catalogs) {
  let deleted = 0;
  for (const sourceTable of SOURCE_TABLES) {
    const incomingIds = new Set((catalogs[sourceTable] || []).map((row) => String(row.__source_id)));
    const { data, error } = await database.from('platform_source_records').select('source_id').eq('source', 'sht-platform').eq('source_table', sourceTable);
    if (error) throw error;
    const staleIds = (data || []).map((row) => row.source_id).filter((sourceId) => !incomingIds.has(sourceId));
    for (const batch of chunks(staleIds)) {
      for (const derivedTable of ['catalog_prices_v2', 'catalog_product_details_v2', 'catalog_reference_data_v2']) {
        const { error: derivedError } = await database.from(derivedTable).delete().eq('source', 'sht-platform').eq('source_table', sourceTable).in('source_id', batch);
        if (derivedError) throw derivedError;
      }
      const { error: sourceError } = await database.from('platform_source_records').delete().eq('source', 'sht-platform').eq('source_table', sourceTable).in('source_id', batch);
      if (sourceError) throw sourceError;
      deleted += batch.length;
    }
  }
  return deleted;
}

function activeProductKeys(catalogs) {
  const keys = new Set();
  const add = (service, value) => {
    const key = typeof value === 'string' ? value.trim() : String(value || '').trim();
    if (key) keys.add(`${service}|${key}`);
  };
  for (const row of catalogs.cruise_info || []) add('cruise', row.cruise_name || row.name);
  for (const row of catalogs.cruise_rate_card || []) add('cruise', row.cruise_name);
  for (const row of catalogs.hotel_info || []) add('hotel', row.hotel_code);
  for (const row of catalogs.hotel_price || []) add('hotel', row.hotel_code);
  for (const row of catalogs.airport_price || []) add('airport', row.airport_code);
  for (const row of catalogs.tour || []) add('tour', row.tour_id);
  for (const row of catalogs.tour_pricing || []) add('tour', row.tour_id);
  for (const row of catalogs.rentcar_price || []) add('vehicle', row.rent_code || row.__source_id);
  return keys;
}

async function removeOrphanProducts(database, catalogs) {
  const activeKeys = activeProductKeys(catalogs);
  const { data, error } = await database.from('catalog_products_v2').select('id,service_type,source_key').eq('source', 'sht-platform');
  if (error) throw error;
  const staleIds = (data || []).filter((row) => !activeKeys.has(`${row.service_type}|${row.source_key}`)).map((row) => row.id);
  for (const batch of chunks(staleIds)) {
    const { error: deleteError } = await database.from('catalog_products_v2').delete().in('id', batch);
    if (deleteError) throw deleteError;
  }
  return staleIds.length;
}

async function applyCatalogOverrides(database, catalogs) {
  let products = 0;
  let prices = 0;
  for (const row of catalogs.homepage_catalog_product_overrides || []) {
    const values = row.values || {};
    const productUpdates = { manual_override: values, updated_at: new Date().toISOString() };
    if (Object.hasOwn(values, 'name_ko')) productUpdates.name_ko = typeof values.name_ko === 'string' && values.name_ko.trim() ? values.name_ko.trim() : null;
    if (Object.hasOwn(values, 'description')) productUpdates.description = typeof values.description === 'string' && values.description.trim() ? values.description.trim() : null;
    if (Object.hasOwn(values, 'category')) productUpdates.category = typeof values.category === 'string' && values.category.trim() ? values.category.trim() : null;
    if (Object.hasOwn(values, 'image_url')) productUpdates.image_url = typeof values.image_url === 'string' && values.image_url.trim() ? values.image_url.trim() : null;
    if (Object.hasOwn(values, 'is_active')) productUpdates.is_active = Boolean(values.is_active);
    const { error } = await database.from('catalog_products_v2').update(productUpdates)
      .eq('source', 'sht-platform').eq('service_type', row.service_type).eq('source_key', row.source_key);
    if (error) throw error;
    products += 1;
  }
  for (const row of catalogs.homepage_catalog_price_overrides || []) {
    const { error } = await database.from('catalog_prices_v2').update({ manual_override: row.values || {}, updated_at: new Date().toISOString() })
      .eq('source', 'sht-platform').eq('source_table', row.source_table).eq('source_id', row.source_id);
    if (error) throw error;
    prices += 1;
  }
  return { products, prices };
}

function matchesSharedSecret(request) {
  const expected = process.env.PLATFORM_SYNC_SECRET;
  const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getHomepageServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request) {
  if (!matchesSharedSecret(request)) {
    return Response.json({ error: '인증되지 않은 동기화 요청입니다.' }, { status: 401 });
  }

  const database = getHomepageServiceClient();
  if (!database) {
    return Response.json({ error: '홈페이지 동기화 서비스 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  if (body?.source !== 'sht-platform' || !body?.catalogs || typeof body.catalogs !== 'object') {
    return Response.json({ error: '지원하지 않는 동기화 본문입니다.' }, { status: 400 });
  }

  const receivedTables = Object.keys(body.catalogs);
  const unsupportedTable = receivedTables.find((table) => !SOURCE_TABLES.has(table));
  const missingTables = [...SOURCE_TABLES].filter((table) => !receivedTables.includes(table));
  if (unsupportedTable || missingTables.length) {
    return Response.json({ error: unsupportedTable ? `허용되지 않은 원본 테이블입니다: ${unsupportedTable}` : `전체 스냅샷에 누락된 테이블이 있습니다: ${missingTables.join(', ')}` }, { status: 400 });
  }

  const records = [];
  const counts = {};
  for (const [sourceTable, rows] of Object.entries(body.catalogs)) {
    if (!Array.isArray(rows)) return Response.json({ error: `${sourceTable} 데이터 형식이 올바르지 않습니다.` }, { status: 400 });
    if (rows.length > 10000) return Response.json({ error: `${sourceTable} 전송 건수가 너무 많습니다.` }, { status: 413 });
    counts[sourceTable] = rows.length;
    for (const row of rows) {
      const sourceId = row?.__source_id || row?.id || row?.option_id || row?.pricing_id || row?.schedule_id
        || row?.inclusion_id || row?.exclusion_id || row?.info_id || row?.payment_pricing_id
        || row?.policy_id || row?.cruise_integration_id || row?.hotel_price_code || row?.hotel_code
        || row?.airport_id || row?.tour_id || row?.rent_code;
      if (!sourceId) return Response.json({ error: `${sourceTable} 원본 식별자가 없습니다.` }, { status: 400 });
      records.push({
        source: 'sht-platform',
        source_table: sourceTable,
        source_id: String(sourceId),
        source_updated_at: row.updated_at || null,
        payload: row,
        synced_at: new Date().toISOString(),
      });
    }
  }

  const { error: recordError } = records.length
    ? await database.from('platform_source_records').upsert(records, { onConflict: 'source,source_table,source_id' })
    : { error: null };
  if (recordError) {
    console.error('[platform-sync] record upsert failed', recordError.message);
    return Response.json({ error: '원본 데이터 저장에 실패했습니다.' }, { status: 500 });
  }

  let deletedSourceRecords = 0;
  try {
    deletedSourceRecords = await removeDeletedSourceRows(database, body.catalogs);
  } catch (error) {
    console.error('[platform-sync] stale source cleanup failed', error?.message || error);
    return Response.json({ error: '삭제된 원본 데이터 정리에 실패했습니다.' }, { status: 500 });
  }

  const { data: transformed, error: transformError } = await database.rpc('refresh_platform_catalog_full_v2');
  if (transformError) {
    console.error('[platform-sync] v2 transform failed', transformError.message);
    return Response.json({ error: '홈페이지용 상품 데이터 가공에 실패했습니다.' }, { status: 500 });
  }


  let deletedProducts = 0;
  let cruiseV2;
  let hotelImagesV2;
  let overrides;
  try {
    deletedProducts = await removeOrphanProducts(database, body.catalogs);
    overrides = await applyCatalogOverrides(database, body.catalogs);
    [cruiseV2, hotelImagesV2] = await Promise.all([
      syncPlatformCruiseV2(database, body.catalogs),
      syncPlatformHotelImagesV2(database, body.catalogs),
    ]);
  } catch (error) {
    console.error('[platform-sync] cache reconciliation failed', error?.message || error);
    return Response.json({ error: '홈페이지 공개 상품 캐시 정리에 실패했습니다.' }, { status: 500 });
  }

  const { error: runError } = await database.from('platform_sync_runs').insert({
    source: 'sht-platform',
    trigger: body.trigger === 'scheduled' ? 'scheduled' : 'manual',
    catalog_counts: counts,
  });
  if (runError) {
    console.error('[platform-sync] run log insert failed', runError.message);
    return Response.json({ error: '동기화 이력 저장에 실패했습니다.' }, { status: 500 });
  }

  return Response.json({ ok: true, received: records.length, deletedSourceRecords, deletedProducts, catalogCounts: counts, transformed, overrides, cruiseV2, hotelImagesV2 });
}
