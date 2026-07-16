import { ALL_CRUISES_DATA } from '@/data/cruisesData';
import { supabase } from '@/lib/supabase';
import { refineTravelAnswer } from '@/lib/agents/aiTravelGuide';

const MAX_MESSAGE_LENGTH = 1_000;
const AGENTS = {
  cruise: { label: '크루즈 추천 서브에이전트', matches: ['추천', '크루즈', '객실', '방', '가격', '예산', '인원', '가족', '허니문'] },
  reservation: { label: '예약 안내 서브에이전트', matches: ['예약', '결제', '확정', '날짜', '변경', '취소'] },
  transfer: { label: '이동 안내 서브에이전트', matches: ['픽업', '셔틀', '하노이', '공항', '이동', '교통'] },
};

function normalizeMessage(message) {
  if (typeof message !== 'string') return '';
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

function chooseAgent(message) {
  const normalized = message.toLowerCase();
  return Object.entries(AGENTS).find(([, agent]) => agent.matches.some((keyword) => normalized.includes(keyword)))?.[0] || 'general';
}

function formatPrice(price, currency = 'VND') {
  return `${new Intl.NumberFormat('ko-KR').format(price)} ${currency}`;
}

function localCatalog() {
  return Object.values(ALL_CRUISES_DATA).map((cruise) => ({ name: cruise.name, duration: cruise.duration, minPrice: cruise.min_price, currency: 'VND', familyFriendly: cruise.cabins?.some((cabin) => /트리플|커넥팅/.test(cabin.name)) }));
}

async function getCruiseCatalog() {
  const [cruisesResult, ratesResult] = await Promise.all([
    supabase.from('cruise_info').select('name, cruise_name, duration'),
    supabase.from('cruise_rate_card').select('cruise_name, price_adult, currency, room_type, room_type_en').eq('is_active', true),
  ]);
  if (cruisesResult.error || ratesResult.error || !cruisesResult.data?.length) return { cruises: localCatalog(), source: 'fallback' };

  const ratesByCruise = new Map();
  for (const rate of ratesResult.data || []) {
    if (!rate.cruise_name || !Number.isFinite(rate.price_adult) || rate.price_adult <= 0) continue;
    const current = ratesByCruise.get(rate.cruise_name);
    const familyFriendly = /트리플|커넥팅|family|triple|connecting/i.test(`${rate.room_type || ''} ${rate.room_type_en || ''}`);
    if (!current || rate.price_adult < current.minPrice) ratesByCruise.set(rate.cruise_name, { minPrice: rate.price_adult, currency: rate.currency || 'VND', familyFriendly });
    else if (familyFriendly) current.familyFriendly = true;
  }

  const byName = new Map();
  for (const cruise of cruisesResult.data) {
    const displayName = cruise.cruise_name || cruise.name;
    if (!displayName || byName.has(displayName)) continue;
    const rate = ratesByCruise.get(displayName) || ratesByCruise.get(cruise.name);
    if (rate) byName.set(displayName, { name: displayName, duration: cruise.duration, ...rate });
  }
  const cruises = [...byName.values()];
  return cruises.length ? { cruises, source: 'live' } : { cruises: localCatalog(), source: 'fallback' };
}

async function recommendCruises(message) {
  const { cruises, source } = await getCruiseCatalog();
  const needsFamilyRoom = /가족|인원|아이|어린이|아동/.test(message);
  const preferred = needsFamilyRoom ? cruises.filter((cruise) => cruise.familyFriendly) : cruises;
  const candidates = (preferred.length ? preferred : cruises).sort((a, b) => a.minPrice - b.minPrice).slice(0, 3);
  return { source, recommendations: candidates.map((cruise) => ({ name: cruise.name, duration: cruise.duration || '일정 확인 필요', fromPrice: cruise.minPrice, currency: cruise.currency, fromPriceLabel: `${formatPrice(cruise.minPrice, cruise.currency)}부터 / 1인`, href: `/product/${encodeURIComponent(cruise.name)}` })) };
}

async function answerFor(agent, message) {
  if (agent === 'cruise') {
    const { recommendations, source } = await recommendCruises(message);
    return { answer: source === 'live' ? '현재 등록된 요금 기준으로 추천했어요. 실제 잔여 객실과 최종 금액은 이용일, 인원, 프로모션에 따라 달라집니다.' : '현재 표시 가능한 상품 기준으로 추천했어요. 정확한 요금과 잔여 객실은 상담을 통해 확인해 주세요.', recommendations, requiresHumanReview: true, suggestedActions: ['이용일과 인원을 알려주세요', '카카오톡으로 실시간 잔여 객실 확인'] };
  }
  if (agent === 'reservation') return { answer: '원하는 날짜와 인원, 여행 스타일을 알려주시면 상품을 추천해드리고, 상품과 일정 확정 후 결제 방법 및 금액을 안내합니다. 취소·변경 수수료는 예약한 크루즈 규정에 따라 달라져 담당자 확인이 필요합니다.', recommendations: [], requiresHumanReview: true, suggestedActions: ['이용일과 인원을 알려주세요', '예약자명과 이용일로 변경·취소 확인'] };
  if (agent === 'transfer') return { answer: '하노이 또는 하롱 지역에서의 픽업 가능 여부는 상품과 출발 시간에 따라 달라집니다. 출발지와 희망 시간을 알려주시면 셔틀 또는 전용 차량 가능 여부를 확인해드립니다.', recommendations: [], requiresHumanReview: true, suggestedActions: ['출발지와 희망 시간을 알려주세요', '선택한 크루즈를 알려주세요'] };
  return { answer: '크루즈 추천, 예약·결제, 픽업·이동을 도와드릴 수 있어요. 이용일, 인원, 원하는 크루즈를 함께 알려주시면 더 정확히 안내해드릴게요.', recommendations: [], requiresHumanReview: false, suggestedActions: ['크루즈 추천 받기', '예약 및 결제 문의', '픽업 및 이동 문의'] };
}

/** Read-only customer guide: never confirms reservations, payments, or changes. */
export async function runTravelSubagent(rawMessage) {
  const message = normalizeMessage(rawMessage);
  if (!message) throw new Error('메시지를 입력해주세요.');
  const intent = chooseAgent(message);
  const result = await answerFor(intent, message);
  const refinement = await refineTravelAnswer({ message, draft: result });
  return { agent: intent === 'general' ? '일반 안내 서브에이전트' : AGENTS[intent].label, intent, message, ...result, answer: refinement.answer, provider: refinement.provider, guardrails: ['예약 확정, 결제 처리, 취소 확정은 담당자 확인 없이 수행하지 않습니다.', '가격과 객실 가능 여부는 최종 확인 전 안내 정보입니다.'] };
}
