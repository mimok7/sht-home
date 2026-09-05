import { revalidatePath } from 'next/cache';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCriterion(value) {
  const criterion = String(value || '').trim().toLowerCase();
  return criterion === 'default' || /^[a-z][a-z0-9-]{0,39}$/.test(criterion) ? criterion : null;
}

function errorResponse(error, fallback, status = 500) {
  console.error(`[homepage-admin] ${fallback}`, error);
  return Response.json({ error: status === 500 ? fallback : error.message }, { status });
}

async function requireOperatorDatabase(request) {
  const operator = await getHomepageOperator(request);
  if (!operator) return { response: Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 }) };
  const database = getHomepageDatabase();
  if (!database) return { response: Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 }) };
  return { operator, database };
}

async function validateEligibleHotels(database, criterion, productIds) {
  if (!productIds.length) return;
  const checks = [
    database.from('catalog_products_v2').select('id').in('id', productIds).eq('source', 'sht-platform').eq('service_type', 'hotel').eq('is_active', true),
  ];
  if (criterion !== 'default') {
    checks.push(database.from('service_tags_v2').select('product_id').in('product_id', productIds).eq('tag', criterion).eq('is_active', true));
  }
  const results = await Promise.all(checks);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;

  const eligibleSets = results.map((result, index) => new Set((result.data || []).map((row) => index === 0 ? row.id : row.product_id)));
  const invalid = productIds.find((productId) => eligibleSets.some((ids) => !ids.has(productId)));
  if (invalid) throw new Error('선택한 추천 기준에 사용할 수 없는 호텔이 포함되어 있습니다.');
}

export async function GET(request) {
  const access = await requireOperatorDatabase(request);
  if (access.response) return access.response;
  const criterion = normalizeCriterion(new URL(request.url).searchParams.get('criterion'));
  if (!criterion) return Response.json({ error: '추천 기준을 확인해 주세요.' }, { status: 400 });

  try {
    const [scopeResult, prioritiesResult] = await Promise.all([
      access.database.from('hotel_recommendation_priority_scopes_v2').select('criterion_tag,revision,updated_by,updated_at').eq('criterion_tag', criterion).maybeSingle(),
      access.database.from('hotel_recommendation_priorities_v2').select('product_id,position,updated_by,updated_at').eq('criterion_tag', criterion).order('position'),
    ]);
    if (scopeResult.error || prioritiesResult.error) throw scopeResult.error || prioritiesResult.error;
    return Response.json({
      ok: true,
      scope: scopeResult.data || { criterion_tag: criterion, revision: 0, updated_by: null, updated_at: null },
      priorities: prioritiesResult.data || [],
      canEdit: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, '호텔 추천순위를 불러오지 못했습니다.');
  }
}

export async function PATCH(request) {
  const access = await requireOperatorDatabase(request);
  if (access.response) return access.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 형식의 요청 본문이 필요합니다.' }, { status: 400 });
  }
  const criterion = normalizeCriterion(body?.criterionTag);
  const productIds = Array.isArray(body?.productIds) ? body.productIds.map((value) => String(value || '').trim()) : null;
  const expectedRevision = Number(body?.expectedRevision);
  if (!criterion || !productIds || productIds.length > 1000 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Response.json({ error: '호텔 추천순위 저장 값을 확인해 주세요.' }, { status: 400 });
  }
  if (productIds.some((productId) => !UUID_PATTERN.test(productId)) || new Set(productIds).size !== productIds.length) {
    return Response.json({ error: '중복되거나 잘못된 호텔이 순위에 포함되어 있습니다.' }, { status: 400 });
  }

  try {
    await validateEligibleHotels(access.database, criterion, productIds);
    const { data, error } = await access.database.rpc('replace_hotel_recommendation_priorities_v2', {
      p_criterion_tag: criterion,
      p_product_ids: productIds,
      p_expected_revision: expectedRevision,
      p_updated_by: access.operator.id,
    });
    if (error) throw error;
    revalidatePath('/hotels');
    return Response.json({ ok: true, scope: data });
  } catch (error) {
    const conflict = error?.code === '40001' || /먼저 변경/.test(error?.message || '');
    const invalid = error?.code === '22023' || /포함되어 있습니다/.test(error?.message || '');
    return errorResponse(error, conflict ? '다른 운영자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' : invalid ? error.message : '호텔 추천순위를 저장하지 못했습니다.', conflict ? 409 : invalid ? 400 : 500);
  }
}
