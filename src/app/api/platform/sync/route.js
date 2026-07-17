// 예약 플랫폼이 전송한 상품 원본을 홈페이지 동기화 스테이징 테이블에 저장한다.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const { data: transformed, error: transformError } = await database.rpc('refresh_platform_catalog_full_v2');
  if (transformError) {
    console.error('[platform-sync] v2 transform failed', transformError.message);
    return Response.json({ error: '홈페이지용 상품 데이터 가공에 실패했습니다.' }, { status: 500 });
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

  return Response.json({ ok: true, received: records.length, catalogCounts: counts, transformed });
}
