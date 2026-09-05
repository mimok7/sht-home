import { revalidatePath } from 'next/cache';
import { getHomepageDatabase, getHomepageOperator } from '@/lib/homepage-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCHEDULE_TYPES = new Set(['ALL', 'DAY', '1N2D', '2N3D']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCriterion(value) {
  const criterion = String(value || '').trim().toLowerCase();
  return criterion === 'default' || /^[a-z][a-z0-9-]{0,39}$/.test(criterion) ? criterion : null;
}

function normalizeSchedule(value) {
  const schedule = String(value || '').trim().toUpperCase();
  return SCHEDULE_TYPES.has(schedule) ? schedule : null;
}

function errorResponse(error, fallback, status = 500) {
  console.error(`[homepage-admin] ${fallback}`, error);
  return Response.json({ error: status === 500 ? fallback : error.message }, { status });
}

async function requireAdminDatabase(request, write = false) {
  const operator = await getHomepageOperator(request);
  if (!operator) return { response: Response.json({ error: '운영자 로그인이 필요합니다.' }, { status: 401 }) };
  if (write && operator.role !== 'admin') return { response: Response.json({ error: '추천순위는 관리자만 변경할 수 있습니다.' }, { status: 403 }) };
  const database = getHomepageDatabase();
  if (!database) return { response: Response.json({ error: '홈페이지 관리자 서비스 키가 설정되지 않았습니다.' }, { status: 503 }) };
  return { operator, database };
}

async function validateEligibleCruises(database, criterion, schedule, cruiseIds) {
  if (!cruiseIds.length) return;

  const checks = [
    database.from('cruises_v2').select('id').in('id', cruiseIds).eq('is_active', true),
  ];
  if (schedule !== 'ALL') {
    checks.push(database.from('cruise_itineraries_v2').select('cruise_id').in('cruise_id', cruiseIds).eq('schedule_type', schedule).eq('is_active', true));
  }
  if (criterion !== 'default') {
    checks.push(database.from('cruise_tags_v2').select('cruise_id').in('cruise_id', cruiseIds).eq('tag', criterion).eq('is_active', true));
  }

  const results = await Promise.all(checks);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;

  const eligibleSets = results.map((result, index) => new Set((result.data || []).map((row) => index === 0 ? row.id : row.cruise_id)));
  const invalid = cruiseIds.find((cruiseId) => eligibleSets.some((ids) => !ids.has(cruiseId)));
  if (invalid) throw new Error('선택한 추천 기준과 일정에 사용할 수 없는 크루즈가 포함되어 있습니다.');
}

export async function GET(request) {
  const access = await requireAdminDatabase(request);
  if (access.response) return access.response;

  const url = new URL(request.url);
  const criterion = normalizeCriterion(url.searchParams.get('criterion'));
  const schedule = normalizeSchedule(url.searchParams.get('schedule'));
  if (!criterion || !schedule) return Response.json({ error: '추천 기준과 일정 범위를 확인해 주세요.' }, { status: 400 });

  try {
    const [scopeResult, prioritiesResult] = await Promise.all([
      access.database
        .from('cruise_recommendation_priority_scopes_v2')
        .select('criterion_tag,schedule_type,revision,updated_by,updated_at')
        .eq('criterion_tag', criterion)
        .eq('schedule_type', schedule)
        .maybeSingle(),
      access.database
        .from('cruise_recommendation_priorities_v2')
        .select('cruise_id,position,updated_by,updated_at')
        .eq('criterion_tag', criterion)
        .eq('schedule_type', schedule)
        .order('position'),
    ]);
    if (scopeResult.error || prioritiesResult.error) throw scopeResult.error || prioritiesResult.error;
    return Response.json({
      ok: true,
      scope: scopeResult.data || { criterion_tag: criterion, schedule_type: schedule, revision: 0, updated_by: null, updated_at: null },
      priorities: prioritiesResult.data || [],
      canEdit: access.operator.role === 'admin',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, '추천순위를 불러오지 못했습니다.');
  }
}

export async function PATCH(request) {
  const access = await requireAdminDatabase(request, true);
  if (access.response) return access.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 형식의 요청 본문이 필요합니다.' }, { status: 400 });
  }

  const criterion = normalizeCriterion(body?.criterionTag);
  const schedule = normalizeSchedule(body?.scheduleType);
  const cruiseIds = Array.isArray(body?.cruiseIds) ? body.cruiseIds.map((value) => String(value || '').trim()) : null;
  const expectedRevision = Number(body?.expectedRevision);
  if (!criterion || !schedule || !cruiseIds || cruiseIds.length > 100 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Response.json({ error: '추천순위 저장 값을 확인해 주세요.' }, { status: 400 });
  }
  if (cruiseIds.some((cruiseId) => !UUID_PATTERN.test(cruiseId)) || new Set(cruiseIds).size !== cruiseIds.length) {
    return Response.json({ error: '중복되거나 잘못된 크루즈가 순위에 포함되어 있습니다.' }, { status: 400 });
  }

  try {
    await validateEligibleCruises(access.database, criterion, schedule, cruiseIds);
    const { data, error } = await access.database.rpc('replace_cruise_recommendation_priorities_v2', {
      p_criterion_tag: criterion,
      p_schedule_type: schedule,
      p_cruise_ids: cruiseIds,
      p_expected_revision: expectedRevision,
      p_updated_by: access.operator.id,
    });
    if (error) throw error;
    revalidatePath('/travel-guide');
    return Response.json({ ok: true, scope: data });
  } catch (error) {
    const conflict = error?.code === '40001' || /먼저 변경/.test(error?.message || '');
    const invalid = error?.code === '22023' || /포함되어 있습니다/.test(error?.message || '');
    return errorResponse(error, conflict ? '다른 관리자가 추천순위를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' : invalid ? error.message : '추천순위를 저장하지 못했습니다.', conflict ? 409 : invalid ? 400 : 500);
  }
}
