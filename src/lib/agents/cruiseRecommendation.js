import { supabase } from '@/lib/supabase';

const SCHEDULE_TYPES = new Set(['DAY', '1N2D', '2N3D']);
const ROOM_PREFERENCES = new Set(['standard', 'triple', 'connecting', 'extra_bed', 'single']);
const PREFERENCES = new Set(['family', 'couple', 'balcony', 'activity', 'value', 'luxury']);
const TRANSFERS = new Set(['none', 'hanoi', 'airport', 'local', 'later']);

function integer(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function normalizeContext(raw = {}) {
  const scheduleType = SCHEDULE_TYPES.has(raw.scheduleType) ? raw.scheduleType : null;
  if (!scheduleType) throw new Error('여행 일정을 선택해주세요.');
  const checkinDate = raw.checkinDate === null || raw.checkinDate === '' ? null : String(raw.checkinDate);
  if (checkinDate && !/^\d{4}-\d{2}-\d{2}$/.test(checkinDate)) throw new Error('출발일 형식이 올바르지 않습니다.');
  const adults = integer(raw.adults, 1, 12, 2);
  const children = integer(raw.children, 0, 8, 0);
  const infants = integer(raw.infants, 0, 4, 0);
  const childAges = Array.isArray(raw.childAges) ? raw.childAges.slice(0, children).map((age) => integer(age, 0, 17, null)) : [];
  if (children && (childAges.length !== children || childAges.includes(null))) throw new Error('아동의 여행일 기준 나이를 입력해주세요.');
  const roomPreference = ROOM_PREFERENCES.has(raw.roomPreference) ? raw.roomPreference : 'standard';
  const requestedRoomCount = integer(raw.roomCount, 1, 6, 1);
  const roomCount = scheduleType === 'DAY' ? 0 : roomPreference === 'connecting' ? Math.max(2, requestedRoomCount) : requestedRoomCount;
  const totalBudgetVnd = raw.totalBudgetVnd ? integer(raw.totalBudgetVnd, 500_000, 200_000_000, null) : null;
  const preferences = Array.isArray(raw.preferences) ? raw.preferences.filter((value) => PREFERENCES.has(value)).slice(0, 2) : [];
  const transfer = TRANSFERS.has(raw.transfer) ? raw.transfer : 'later';
  return { scheduleType, checkinDate, adults, children, infants, childAges, roomCount, roomPreference, totalBudgetVnd, preferences, transfer };
}

function dateMatches(rate, checkinDate) {
  if (!checkinDate) return true;
  return (!rate.valid_from || rate.valid_from <= checkinDate) && (!rate.valid_to || rate.valid_to >= checkinDate);
}

function ratePrice(rate, context) {
  if (context.roomPreference === 'single' && Number.isFinite(rate.price_single) && rate.price_single > 0) return rate.price_single;
  return Number.isFinite(rate.price_adult) && rate.price_adult > 0 ? rate.price_adult : null;
}

function cabinFits(cabin, context) {
  if (context.scheduleType === 'DAY') return true;
  const guests = context.adults + context.children + context.infants;
  if ((cabin.max_guests || 0) * context.roomCount < guests) return false;
  if ((cabin.max_adults || cabin.max_guests || 0) * context.roomCount < context.adults) return false;
  if (context.roomPreference === 'triple' && (cabin.max_guests || 0) < 3) return false;
  if (context.roomPreference === 'connecting' && !cabin.connecting_available) return false;
  if (context.roomPreference === 'extra_bed' && !cabin.extra_bed_available) return false;
  return true;
}

function formatVnd(value) {
  return `${new Intl.NumberFormat('ko-KR').format(value)} VND`;
}

function preferenceScore(cruise, cabin, preference) {
  if (preference === 'family') return cabin.connecting_available || cabin.extra_bed_available || cabin.max_guests >= 3 ? [13, '가족 객실 구성이 가능해요'] : [0, null];
  if (preference === 'couple') return cabin.has_balcony || cabin.is_vip ? [13, '커플 여행에 어울리는 객실 특성이 있어요'] : [0, null];
  if (preference === 'balcony') return cabin.has_balcony ? [13, '전용 발코니 객실을 선택할 수 있어요'] : [0, null];
  if (preference === 'activity') return cabin.facilities || cabin.special_amenities ? [10, '선상 시설과 특별 편의 정보가 등록되어 있어요'] : [0, null];
  if (preference === 'luxury') return cabin.is_vip || cabin.has_butler ? [13, 'VIP 객실 또는 전담 서비스 조건에 가까워요'] : [0, null];
  return [0, null];
}

async function loadRecommendationData(context) {
  const { data, error } = await supabase
    .from('public_cruise_recommendation_v2')
    .select('cruise_id,slug,cruise_name,cruise_name_en,description,category,star_rating,hero_image,itinerary_id,schedule_type,nights,cabin_id,cabin_name,cabin_name_en,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,rate_plan_id,valid_from,valid_to,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,tags')
    .eq('schedule_type', context.scheduleType);
  if (error) throw new Error('현재 v2 추천 상품 정보를 불러오지 못했습니다.');
  return { rows: (data || []).filter((row) => dateMatches(row, context.checkinDate)), source: 'v2' };
}

function buildCandidates(rows, context) {
  const cruises = new Map();
  for (const row of rows) {
    if (!row.cruise_id || !row.cruise_name) continue;
    if (!cruises.has(row.cruise_id)) cruises.set(row.cruise_id, { id: row.cruise_id, name: row.cruise_name, rows: [] });
    cruises.get(row.cruise_id).rows.push(row);
  }

  const candidates = [];
  for (const cruise of cruises.values()) {
    let best = null;
    for (const row of cruise.rows) {
      if (!cabinFits(row, context)) continue;
      if (context.roomPreference === 'single' && row.single_available !== true) continue;
      const price = ratePrice(row, context);
      if (price && (!best || price < best.price)) best = { cabin: row, rate: row, price };
    }
    if (!best) continue;

    const reasons = ['선택한 일정과 인원 조건에 맞아요'];
    let score = 45;
    if (best.cabin.is_recommended) { score += 8; reasons.push('현지 추천 객실이 등록되어 있어요'); }
    for (const preference of context.preferences) {
      if (preference === 'value') continue;
      const [points, reason] = preferenceScore(cruise, best.cabin, preference);
      score += points;
      if (reason) reasons.push(reason);
    }
    const referenceTotal = best.price * Math.max(context.roomCount, 1);
    if (context.totalBudgetVnd) {
      if (referenceTotal <= context.totalBudgetVnd) { score += 20; reasons.push('입력한 예산 범위 안의 등록 요금이에요'); }
      else score -= Math.min(20, Math.round((referenceTotal - context.totalBudgetVnd) / context.totalBudgetVnd * 20));
    }
    if (context.preferences.includes('value')) { score += Math.max(0, 12 - Math.floor(best.price / 1_000_000)); reasons.push('등록 요금이 비교적 낮은 후보예요'); }

    const confirmations = ['실시간 객실 잔여 여부', '등록 요금의 적용 단위와 최종 금액'];
    if (context.children || context.infants) confirmations.push(best.rate.child_age_range ? '아동 나이에 따른 최종 요금' : '아동·유아 연령별 요금 규정');
    if (context.transfer !== 'none' && context.transfer !== 'local') confirmations.push('픽업 가능 여부와 차량 요금');
    candidates.push({
      name: cruise.name,
      duration: context.scheduleType === 'DAY' ? '당일' : context.scheduleType === '2N3D' ? '2박 3일' : '1박 2일',
      cabinName: best.cabin.cabin_name,
      registeredPrice: best.price,
      currency: best.rate.currency || 'VND',
      registeredPriceLabel: `${formatVnd(best.price)} 등록요금부터`,
      referenceTotalLabel: context.roomCount > 1 ? `객실 ${context.roomCount}개 단순 참고 ${formatVnd(referenceTotal)}` : null,
      reasons: [...new Set(reasons)].slice(0, 3),
      confirmations: [...new Set(confirmations)],
      score,
      href: `/product/${encodeURIComponent(best.cabin.slug)}`,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.registeredPrice - b.registeredPrice).slice(0, 3);
}

export async function recommendCruisesForContext(rawContext) {
  const context = normalizeContext(rawContext);
  const { rows, source } = await loadRecommendationData(context);
  const recommendations = buildCandidates(rows, context);
  const party = `성인 ${context.adults}명${context.children ? ` · 아동 ${context.children}명` : ''}${context.infants ? ` · 유아 ${context.infants}명` : ''}`;
  const date = context.checkinDate || '날짜 미정';
  return {
    agent: '크루즈 맞춤 추천 서브에이전트',
    intent: 'cruise_recommendation',
    provider: 'rules',
    dataSource: source,
    context,
    answer: recommendations.length
      ? `${party}, ${date} 조건으로 ${recommendations.length}개 후보를 찾았어요. 등록 요금은 비교 참고용이며 최종 금액과 객실 가능 여부는 현지 데스크가 확인합니다.`
      : `${party}, ${date} 조건에 정확히 맞는 후보를 찾지 못했어요. 일정이나 객실 구성을 조정하거나 현지 데스크에 확인해주세요.`,
    recommendations,
    requiresHumanReview: true,
    guardrails: ['실시간 재고를 확정하지 않습니다.', '등록 요금의 단위와 최종 합계는 담당자 확인 전 확정하지 않습니다.'],
  };
}
