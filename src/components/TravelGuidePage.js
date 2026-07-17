'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import styles from './TravelGuidePage.module.css';

const KAKAO_CHAT_URL = 'http://pf.kakao.com/_zvsxaG/chat';
const DEFAULT_CONTEXT = { scheduleType: '', checkinDate: null, adults: 2, children: 0, infants: 0, childAges: [], roomCount: 1, roomPreference: 'standard', totalBudgetVnd: null, preferences: [], transfer: 'later' };
const LABELS = {
  scheduleType: { DAY: '당일 크루즈', '1N2D': '1박 2일', '2N3D': '2박 3일' },
  roomPreference: { standard: '일반 객실', triple: '트리플', connecting: '커넥팅', extra_bed: '엑스트라베드', single: '싱글룸' },
  preference: { family: '가족 편의', couple: '허니문·커플', balcony: '전용 발코니', activity: '시설·액티비티', value: '합리적인 가격', luxury: 'VIP 서비스' },
  transfer: { none: '이동 불필요', hanoi: '하노이 왕복', airport: '공항 이동', local: '하롱 현지 합류', later: '나중에 결정' },
};
const PRICE_UNIT_LABELS = { per_adult: '성인 1인', per_person: '1인', per_room: '객실 1실', per_vehicle: '차량 1대', unknown: '요금 기준 확인' };
const SERVICE_GUIDES = [
  { id: 'cruise', number: '01', label: '크루즈', title: '내 여행에 맞는 크루즈 찾기.', description: '일정·인원·객실·예산을 입력하면 실제 객실과 활성 요금을 기준으로 추천합니다.', checks: ['출발 일정과 숙박 여부', '동행 인원과 객실 구성', '원하는 여행 스타일'] },
  { id: 'hotel', number: '02', label: '호텔', title: '하롱 숙소를 비교해 보세요.', description: '체크인 일정과 객실 유형, 조식·위치 같은 숙박 조건을 확인해 선택하세요.', checks: ['체크인·체크아웃 날짜', '객실과 투숙 인원', '조식·위치·취소 조건'] },
  { id: 'tour', number: '03', label: '투어', title: '여행 일정에 맞는 투어를 고르세요.', description: '투어별 출발 조건, 포함 사항, 인원별 요금을 확인한 뒤 현지 데스크와 확정합니다.', checks: ['투어 날짜와 출발 장소', '포함·불포함 사항', '최소·최대 참여 인원'] },
  { id: 'airport', number: '04', label: '공항', title: '공항 이동을 미리 준비하세요.', description: '공항 코드와 차량 종류, 탑승 인원을 기준으로 픽업·샌딩 조건을 확인합니다.', checks: ['도착·출발 항공편 시간', '탑승 인원과 수하물', '픽업 또는 샌딩 구간'] },
  { id: 'vehicle', number: '05', label: '차량', title: '이동 차량을 비교해 보세요.', description: '이동 구간과 차량 유형, 최대 탑승 인원을 확인해 여행 동선을 연결합니다.', checks: ['출발·도착 장소', '편도 또는 왕복 여부', '차량별 최대 탑승 인원'] },
];
const SERVICE_FLOWS = {
  hotel: [
    { id: 'date', label: '투숙 일정', type: 'date', title: '언제 투숙하나요?', description: '선택한 날짜에 적용 가능한 요금을 우선 확인합니다.' },
    { id: 'guests', label: '투숙 인원', type: 'counter', title: '몇 분이 함께 투숙하나요?', description: '객실별 수용 인원이 등록된 경우 가능한 객실만 남깁니다.', counterLabel: '투숙 인원', min: 1, max: 12 },
    { id: 'room', label: '객실 선호', type: 'options', title: '어떤 객실을 찾으세요?', description: '선호 조건은 상담 요청에 함께 전달됩니다.', options: [['standard', '기본 객실', '합리적인 숙박'], ['family', '가족 객실', '여러 명이 함께'], ['premium', '프리미엄 객실', '뷰와 편의 우선']] },
  ],
  tour: [
    { id: 'date', label: '투어 날짜', type: 'date', title: '언제 투어에 참여하나요?', description: '선택한 날짜에 적용 가능한 투어 요금을 우선 확인합니다.' },
    { id: 'guests', label: '참여 인원', type: 'counter', title: '몇 분이 참여하나요?', description: '투어별 최소·최대 참여 인원이 등록된 경우 결과에 반영합니다.', counterLabel: '참여 인원', min: 1, max: 20 },
    { id: 'style', label: '투어 방식', type: 'options', title: '어떤 투어를 원하세요?', description: '선호 방식은 현지 데스크 상담 시 확인합니다.', options: [['group', '조인 투어', '다른 여행객과 함께'], ['private', '단독 투어', '우리 일행 중심'], ['flexible', '추천 후 결정', '일정부터 비교']] },
  ],
  airport: [
    { id: 'direction', label: '이동 방향', type: 'options', title: '어떤 공항 이동이 필요하신가요?', description: '선택한 이동 조건을 픽업·샌딩 상담에 반영합니다.', options: [['pickup', '공항 픽업', '공항에서 숙소 또는 하롱'], ['dropoff', '공항 샌딩', '하롱 또는 숙소에서 공항'], ['roundtrip', '왕복 이동', '픽업과 샌딩 모두']] },
    { id: 'guests', label: '탑승 인원', type: 'counter', title: '차량에 몇 분이 탑승하나요?', description: '등록된 최대 탑승 인원보다 적은 차량을 제외합니다.', counterLabel: '탑승 인원', min: 1, max: 20 },
    { id: 'timing', label: '항공편 시간', type: 'options', title: '항공편 시간대를 알려주세요.', description: '정확한 항공편 번호와 시간은 상담 시 최종 확인합니다.', options: [['day', '주간 이동', '오전 07:00~오후 21:00'], ['night', '야간 이동', '야간 또는 이른 새벽'], ['later', '아직 미정', '상품부터 비교']] },
  ],
  vehicle: [
    { id: 'route', label: '이동 구간', type: 'options', title: '주요 이동 구간을 선택하세요.', description: '정확한 출발·도착지는 상담 요청에 함께 전달됩니다.', options: [['hanoi', '하노이 ↔ 하롱', '장거리 이동'], ['airport', '공항 ↔ 하롱', '공항 연계 이동'], ['local', '하롱 현지 이동', '근거리 차량'], ['custom', '직접 입력 상담', '원하는 구간 확인']] },
    { id: 'guests', label: '탑승 인원', type: 'counter', title: '차량에 몇 분이 탑승하나요?', description: '등록된 최대 탑승 인원보다 적은 차량을 제외합니다.', counterLabel: '탑승 인원', min: 1, max: 20 },
    { id: 'wayType', label: '이용 방식', type: 'options', title: '편도 또는 왕복 중 선택하세요.', description: '예약 전 실제 운행 가능 여부와 요금은 확인이 필요합니다.', options: [['oneway', '편도', '한 방향 이동'], ['roundtrip', '왕복', '가는 길과 오는 길'], ['charter', '단독 대절', '일정에 맞춰 이용']] },
  ],
};

function Counter({ label, value, min, max, onChange }) {
  return <div className={styles.counter}><span>{label}</span><div><button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label} 줄이기`}>−</button><b>{value}</b><button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label} 늘리기`}>＋</button></div></div>;
}

export default function TravelGuidePage() {
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [currentStep, setCurrentStep] = useState('schedule');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedService, setSelectedService] = useState('cruise');
  const [catalog, setCatalog] = useState({ products: [], prices: [] });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const steps = useMemo(() => ['schedule', 'date', 'party', ...(context.children ? ['ages'] : []), ...(context.scheduleType !== 'DAY' ? ['room'] : []), 'budget', 'preferences', 'transfer', 'review'], [context.children, context.scheduleType]);
  const stepIndex = Math.max(0, steps.indexOf(currentStep));
  const update = (values) => setContext((previous) => ({ ...previous, ...values }));
  const next = () => setCurrentStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const back = () => setCurrentStep(steps[Math.max(stepIndex - 1, 0)]);
  const choose = (values, nextStep) => { update(values); setCurrentStep(nextStep); setResult(null); setError(''); };
  const activeService = SERVICE_GUIDES.find((service) => service.id === selectedService) || SERVICE_GUIDES[0];
  const serviceProducts = useMemo(() => {
    const pricesByProduct = new Map();
    for (const price of catalog.prices) {
      if (!pricesByProduct.has(price.product_id)) pricesByProduct.set(price.product_id, []);
      pricesByProduct.get(price.product_id).push(price);
    }
    return catalog.products
      .filter((product) => product.service_type === selectedService)
      .map((product) => {
        const activePrices = (pricesByProduct.get(product.id) || []).filter((price) => price.price_amount !== null && Number.isFinite(Number(price.price_amount)));
        const lowestPrice = activePrices.sort((left, right) => Number(left.price_amount) - Number(right.price_amount))[0] || null;
        return { ...product, prices: activePrices, lowestPrice };
      });
  }, [catalog, selectedService]);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setCatalogLoading(true);
      const [productsResult, pricesResult] = await Promise.all([
        supabase.from('catalog_products_v2').select('id,service_type,name_ko,description,category,image_url,metadata').eq('is_active', true).order('name_ko').limit(1000),
        supabase.from('catalog_prices_v2').select('product_id,price_amount,currency,price_unit,label,min_guests,max_guests,valid_from,valid_to').eq('is_active', true).limit(2000),
      ]);
      if (cancelled) return;
      if (productsResult.error || pricesResult.error) {
        console.error('Failed to load public travel catalogue:', productsResult.error || pricesResult.error);
        setCatalogError('현재 공개 상품을 불러오지 못했습니다. 현지 데스크에 문의해 주세요.');
      } else {
        setCatalog({ products: productsResult.data || [], prices: pricesResult.data || [] });
      }
      setCatalogLoading(false);
    }
    void loadCatalog();
    return () => { cancelled = true; };
  }, []);

  function updateParty(field, value) {
    if (field === 'children') {
      const childAges = Array.from({ length: value }, (_, index) => context.childAges[index] ?? 7);
      update({ children: value, childAges });
      return;
    }
    update({ [field]: value });
  }

  function togglePreference(value) {
    const selected = context.preferences.includes(value);
    if (selected) update({ preferences: context.preferences.filter((item) => item !== value) });
    else if (context.preferences.length < 2) update({ preferences: [...context.preferences, value] });
  }

  async function requestRecommendations() {
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'recommend', context }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '추천 결과를 불러오지 못했습니다.');
      setResult(data);
    } catch (requestError) { setError(requestError.message || '네트워크 연결을 확인해주세요.'); }
    finally { setLoading(false); }
  }

  function reset() { setContext(DEFAULT_CONTEXT); setCurrentStep('schedule'); setResult(null); setError(''); }
  function selectService(service) { setSelectedService(service); setError(''); setResult(null); }

  const question = (() => {
    if (currentStep === 'schedule') return <><Question title="어떤 하롱 여행을 찾고 계세요?" description="일정을 먼저 나누면 비교할 수 있는 상품과 요금이 정확해져요." /><Options options={[['DAY', '당일 크루즈', '숙박 없이 하루 동안'], ['1N2D', '1박 2일', '가장 많이 선택하는 일정'], ['2N3D', '2박 3일', '하롱을 여유롭게']]} onSelect={(value) => choose({ scheduleType: value }, 'date')} /></>;
    if (currentStep === 'date') return <><Question title="언제 출발할 예정인가요?" description="출발일에 유효한 요금만 비교합니다. 아직 정하지 않았다면 전체 활성 요금으로 찾아드려요." /><div className={styles.dateChoice}><label htmlFor="guide-date">출발일</label><input id="guide-date" type="date" min={new Date().toISOString().slice(0, 10)} value={context.checkinDate || ''} onChange={(event) => update({ checkinDate: event.target.value })} /><button type="button" disabled={!context.checkinDate} onClick={next}>선택한 날짜로 계속 <span>→</span></button><button type="button" className={styles.secondary} onClick={() => choose({ checkinDate: null }, 'party')}>날짜 미정</button></div></>;
    if (currentStep === 'party') return <><Question title="누가 함께 여행하나요?" description="객실 수용 인원과 적용 가능한 요금을 확인할 때 사용합니다." /><div className={styles.counters}><Counter label="성인" value={context.adults} min={1} max={12} onChange={(value) => updateParty('adults', value)} /><Counter label="아동" value={context.children} min={0} max={8} onChange={(value) => updateParty('children', value)} /><Counter label="유아" value={context.infants} min={0} max={4} onChange={(value) => updateParty('infants', value)} /></div><Continue onClick={next} /></>;
    if (currentStep === 'ages') return <><Question title="아동의 여행일 기준 나이를 알려주세요." description="크루즈마다 아동 요금 기준이 달라 최종 확인에 꼭 필요합니다." /><div className={styles.ages}>{context.childAges.map((age, index) => <label key={index}>{index + 1}번째 아동<input type="number" min="0" max="17" value={age} onChange={(event) => { const childAges = [...context.childAges]; childAges[index] = Number(event.target.value); update({ childAges }); }} /><span>만 나이</span></label>)}</div><Continue onClick={next} /></>;
    if (currentStep === 'room') return <><Question title="어떤 객실 구성이 필요한가요?" description="전체 인원이 실제로 머물 수 있는 객실만 남깁니다." /><Counter label="객실 수" value={context.roomCount} min={1} max={6} onChange={(value) => update({ roomCount: value })} /><Options options={[['standard', '일반 객실', '특별한 구성 없음'], ['triple', '트리플 객실', '객실당 3인 이상'], ['connecting', '커넥팅 객실', '객실을 연결해서 사용'], ['extra_bed', '엑스트라베드', '추가 침대 필요'], ['single', '싱글룸', '1인 객실 필요']]} selected={context.roomPreference} onSelect={(value) => choose({ roomPreference: value, roomCount: value === 'connecting' ? Math.max(2, context.roomCount) : context.roomCount }, 'budget')} /></>;
    if (currentStep === 'budget') return <><Question title="전체 여행 예산은 어느 정도인가요?" description="현재 요금 단위가 상품별로 달라 예산은 후보 순위를 정하는 참고 조건으로 사용합니다." /><Options options={[[5_000_000, '500만 VND 이하', '합리적인 가격 우선'], [8_000_000, '800만 VND 이하', '가격과 객실 균형'], [12_000_000, '1,200만 VND 이하', '프리미엄 객실 포함'], [20_000_000, '2,000만 VND 이하', 'VIP 객실까지 비교'], [null, '예산보다 조건이 중요해요', '예산 제한 없이 비교']]} onSelect={(value) => choose({ totalBudgetVnd: value }, 'preferences')} /></>;
    if (currentStep === 'preferences') return <><Question title="무엇을 가장 중요하게 보고 계세요?" description="최대 2개를 선택하면 추천 순서와 추천 이유에 반영합니다." /><div className={styles.multiOptions}>{Object.entries(LABELS.preference).map(([value, label]) => <button type="button" key={value} className={context.preferences.includes(value) ? styles.selected : ''} onClick={() => togglePreference(value)} aria-pressed={context.preferences.includes(value)}><b>{label}</b><span>{context.preferences.includes(value) ? '선택됨' : '선택'}</span></button>)}</div><Continue onClick={next} label={context.preferences.length ? '선택 완료' : '건너뛰기'} /></>;
    if (currentStep === 'transfer') return <><Question title="하노이 또는 공항 이동도 필요하신가요?" description="차량과 셔틀은 추천 후 현지 데스크가 최종 확인합니다." /><Options options={Object.entries(LABELS.transfer).map(([value, label]) => [value, label, value === 'later' ? '추천 후 결정' : '이동 조건으로 저장'])} onSelect={(value) => choose({ transfer: value }, 'review')} /></>;
    return <><Question title="조건을 확인해 주세요." description="추천 결과는 등록된 상품과 활성 요금을 기준으로 계산합니다." /><div className={styles.summary}><Summary label="일정" value={LABELS.scheduleType[context.scheduleType]} onEdit={() => setCurrentStep('schedule')} /><Summary label="출발일" value={context.checkinDate || '날짜 미정'} onEdit={() => setCurrentStep('date')} /><Summary label="인원" value={`성인 ${context.adults} · 아동 ${context.children} · 유아 ${context.infants}`} onEdit={() => setCurrentStep('party')} />{context.scheduleType !== 'DAY' && <Summary label="객실" value={`${context.roomCount}개 · ${LABELS.roomPreference[context.roomPreference]}`} onEdit={() => setCurrentStep('room')} />}<Summary label="예산" value={context.totalBudgetVnd ? `${context.totalBudgetVnd.toLocaleString()} VND` : '제한 없음'} onEdit={() => setCurrentStep('budget')} /><Summary label="선호" value={context.preferences.map((value) => LABELS.preference[value]).join(', ') || '선택 없음'} onEdit={() => setCurrentStep('preferences')} /><Summary label="이동" value={LABELS.transfer[context.transfer]} onEdit={() => setCurrentStep('transfer')} /></div><button type="button" className={styles.recommendButton} onClick={requestRecommendations} disabled={loading}>{loading ? '상품을 비교하고 있어요' : '맞춤 크루즈 추천 보기'} <span>→</span></button></>;
  })();

  return <main className={styles.page}>
    <section className={styles.hero}><div><p>LOCAL DESK / TRAVEL GUIDE</p><h1>하롱 여행의<br /><span>모든 준비.</span></h1><strong>CRUISE · HOTEL · TOUR · AIRPORT · VEHICLE</strong><div className={styles.serviceNav} aria-label="여행 서비스 선택">{SERVICE_GUIDES.map((service) => <button type="button" key={service.id} className={selectedService === service.id ? styles.selectedService : ''} onClick={() => selectService(service.id)} aria-pressed={selectedService === service.id}><b>{service.number}</b>{service.label}</button>)}</div></div><aside><b>{activeService.number}</b><p>{activeService.description}</p></aside></section>
    <section className={styles.content} aria-label={`하롱 ${activeService.label} 여행 안내`}>
      {selectedService === 'cruise' ? <><aside className={styles.notes}><p>YOUR JOURNEY</p><ol>{steps.slice(0, -1).map((step, index) => <li key={step} className={index === stepIndex ? styles.current : index < stepIndex ? styles.done : ''}><b>{String(index + 1).padStart(2, '0')}</b>{stepLabel(step)}</li>)}</ol><a href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">바로 카카오 상담 <span>↗</span></a></aside><div className={styles.chat}><header><p>STEP {String(stepIndex + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</p><div className={styles.progress}><i style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div></header><div className={styles.conversation} aria-live="polite">{question}{stepIndex > 0 && currentStep !== 'review' && <button type="button" className={styles.back} onClick={back}>← 이전 질문</button>}{error && <p className={styles.error}>{error}</p>}{result && <RecommendationResult result={result} onReset={reset} />}</div></div></> : <ServiceGuideFlow key={selectedService} service={activeService} products={serviceProducts} loading={catalogLoading} error={catalogError} />}
    </section>
  </main>;
}

function Question({ title, description }) { return <div className={styles.question}><h2>{title}</h2><p>{description}</p></div>; }
function Options({ options, onSelect, selected }) { return <div className={styles.options}>{options.map(([value, label, detail]) => <button type="button" key={String(value)} className={selected === value ? styles.selected : ''} onClick={() => onSelect(value)}><span><b>{label}</b><small>{detail}</small></span><i>→</i></button>)}</div>; }
function Continue({ onClick, label = '다음 질문' }) { return <button type="button" className={styles.continueButton} onClick={onClick}>{label}<span>→</span></button>; }
function Summary({ label, value, onEdit }) { return <div><span>{label}</span><b>{value}</b><button type="button" onClick={onEdit}>수정</button></div>; }
function RecommendationResult({ result, onReset }) { return <article className={styles.results}><div className={styles.resultIntro}><p>{result.agent}</p><strong>{result.answer}</strong></div>{result.recommendations.map((cruise, index) => <Link className={styles.resultCard} key={cruise.href} href={cruise.href}><span>{String(index + 1).padStart(2, '0')} / {cruise.duration}</span><h3>{cruise.name}</h3><p>{cruise.cabinName}</p><strong>{cruise.registeredPriceLabel}</strong>{cruise.referenceTotalLabel && <small>{cruise.referenceTotalLabel}</small>}<ul>{cruise.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div><b>확인 필요</b>{cruise.confirmations.join(' · ')}</div></Link>)}{!result.recommendations.length && <a className={styles.kakaoResult} href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">현지 데스크에 조건 확인 <span>↗</span></a>}<button type="button" className={styles.restart} onClick={onReset}>조건 다시 선택하기</button></article>; }
function ServiceGuideFlow({ service, products, loading, error }) {
  const flow = SERVICE_FLOWS[service.id] || [];
  const steps = [...flow, { id: 'review', label: '조건 확인', type: 'review' }];
  const [answers, setAnswers] = useState({ guests: 2 });
  const [currentStep, setCurrentStep] = useState(steps[0]?.id || 'results');
  const isResults = currentStep === 'results';
  const stepIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  const current = steps[stepIndex];
  const matchedProducts = useMemo(() => filterServiceProducts(products, answers), [products, answers]);
  const updateAnswer = (values) => setAnswers((previous) => ({ ...previous, ...values }));
  const next = () => setCurrentStep(steps[Math.min(stepIndex + 1, steps.length - 1)]?.id || 'results');
  const back = () => setCurrentStep(steps[Math.max(stepIndex - 1, 0)]?.id || steps[0]?.id);
  const choose = (field, value) => { updateAnswer({ [field]: value }); next(); };

  let question = null;
  if (isResults) question = <ServiceCatalogResults service={service} products={matchedProducts} allProducts={products} loading={loading} error={error} onReset={() => { setAnswers({ guests: 2 }); setCurrentStep(steps[0]?.id || 'results'); }} />;
  else if (current?.type === 'date') question = <><Question title={current.title} description={current.description} /><div className={styles.dateChoice}><label htmlFor={`${service.id}-${current.id}`}>예정일</label><input id={`${service.id}-${current.id}`} type="date" min={new Date().toISOString().slice(0, 10)} value={answers[current.id] || ''} onChange={(event) => updateAnswer({ [current.id]: event.target.value })} /><button type="button" disabled={!answers[current.id]} onClick={next}>선택한 날짜로 계속 <span>→</span></button><button type="button" className={styles.secondary} onClick={() => choose(current.id, '')}>날짜 미정</button></div></>;
  else if (current?.type === 'counter') question = <><Question title={current.title} description={current.description} /><div className={styles.counters}><Counter label={current.counterLabel} value={answers[current.id] || current.min} min={current.min} max={current.max} onChange={(value) => updateAnswer({ [current.id]: value })} /></div><Continue onClick={next} /></>;
  else if (current?.type === 'options') question = <><Question title={current.title} description={current.description} /><Options options={current.options} selected={answers[current.id]} onSelect={(value) => choose(current.id, value)} /></>;
  else if (current?.type === 'review') question = <><Question title="선택한 조건을 확인해 주세요." description="등록된 공개 상품과 활성 요금에서 적용 가능한 조건을 우선 반영해 보여드립니다." /><div className={styles.summary}>{flow.map((step) => <Summary key={step.id} label={step.label} value={serviceAnswerLabel(step, answers[step.id])} onEdit={() => setCurrentStep(step.id)} />)}</div><button type="button" className={styles.recommendButton} onClick={() => setCurrentStep('results')}>{service.label} 상품 보기 <span>→</span></button></>;

  return <><ServiceGuideSidebar service={service} steps={steps} currentStep={currentStep} /><div className={styles.chat}><header><p>STEP {String(isResults ? steps.length : stepIndex + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')} · {service.label.toUpperCase()}</p><div className={styles.progress}><i style={{ width: `${((isResults ? steps.length : stepIndex + 1) / steps.length) * 100}%` }} /></div></header><div className={styles.conversation} aria-live="polite">{question}{!isResults && stepIndex > 0 && <button type="button" className={styles.back} onClick={back}>← 이전 질문</button>}</div></div></>;
}
function ServiceGuideSidebar({ service, steps, currentStep }) { const currentIndex = steps.findIndex((step) => step.id === currentStep); return <aside className={styles.notes}><p>{service.label.toUpperCase()} JOURNEY</p><ol>{steps.map((step, index) => <li key={step.id} className={index === currentIndex ? styles.current : index < currentIndex || currentStep === 'results' ? styles.done : ''}><b>{String(index + 1).padStart(2, '0')}</b>{step.label}</li>)}</ol><a href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">현지 데스크 상담 <span>↗</span></a></aside>; }
function ServiceCatalogResults({ service, products, allProducts, loading, error, onReset }) { return <><Question title={`${service.label} 조건에 맞는 상품입니다.`} description="선택한 일정과 인원 조건을 우선 반영했습니다. 정확한 가용 여부와 최종 요금은 상담 시 확인합니다." /><div className={styles.serviceBrief}><span>{service.number} / 결과 안내</span><ul>{service.checks.map((check) => <li key={check}>{check}</li>)}</ul></div><div className={styles.catalogHeading}><span>ACTIVE HOMEPAGE DATA</span><strong>{loading ? '상품을 불러오는 중…' : `조건 일치 ${products.length}개 / 전체 ${allProducts.length}개`}</strong></div>{error ? <p className={styles.error}>{error}</p> : loading ? <p className={styles.catalogLoading}>상품 정보를 불러오는 중입니다.</p> : products.length ? <div className={styles.catalogProducts}>{products.slice(0, 12).map((product, index) => <article className={styles.catalogProduct} key={product.id}><span>{String(index + 1).padStart(2, '0')} / {product.category || service.label.toUpperCase()}</span><h3>{product.name_ko}</h3><p>{product.description || '세부 조건과 이용 가능 여부는 현지 데스크에서 확인해 주세요.'}</p><strong>{catalogPriceLabel(product.lowestPrice)}</strong>{product.lowestPrice?.label && <small>{product.lowestPrice.label}</small>}</article>)}</div> : <div className={styles.catalogEmpty}><strong>조건에 맞는 공개 상품이 없습니다.</strong><p>조건을 다시 선택하거나 현지 데스크에 문의해 주세요.</p></div>}{products.length > 12 && <p className={styles.catalogMore}>조건에 맞는 대표 12개를 표시했습니다. 전체 상품과 정확한 조건은 현지 데스크에서 안내합니다.</p>}<a className={styles.catalogConsult} href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">{service.label} 상담 요청 <span>↗</span></a><button type="button" className={styles.restart} onClick={onReset}>조건 다시 선택하기</button></>; }
function filterServiceProducts(products, answers) { return products.map((product) => { const availablePrices = product.prices.filter((price) => isMatchingPrice(price, answers)); if (product.prices.length && !availablePrices.length) return null; const lowestPrice = [...(availablePrices.length ? availablePrices : product.prices)].sort((left, right) => Number(left.price_amount) - Number(right.price_amount))[0] || product.lowestPrice; return { ...product, lowestPrice }; }).filter(Boolean).sort((left, right) => Number(left.lowestPrice?.price_amount ?? Number.MAX_SAFE_INTEGER) - Number(right.lowestPrice?.price_amount ?? Number.MAX_SAFE_INTEGER)); }
function isMatchingPrice(price, answers) { if (answers.date && ((price.valid_from && price.valid_from > answers.date) || (price.valid_to && price.valid_to < answers.date))) return false; if (answers.guests && price.min_guests && Number(price.min_guests) > Number(answers.guests)) return false; if (answers.guests && price.max_guests && Number(price.max_guests) < Number(answers.guests)) return false; return true; }
function serviceAnswerLabel(step, value) { if (step.type === 'date') return value || '날짜 미정'; if (step.type === 'counter') return `${value || step.min}명`; return step.options?.find(([option]) => option === value)?.[1] || '선택 안 함'; }
function catalogPriceLabel(price) { return price ? `${Number(price.price_amount).toLocaleString('ko-KR')} ${price.currency || 'VND'}부터 · ${PRICE_UNIT_LABELS[price.price_unit] || '요금 기준 확인'}` : '요금 상담 필요'; }
function stepLabel(step) { return ({ schedule: '여행 일정', date: '출발일', party: '여행 인원', ages: '아동 나이', room: '객실 구성', budget: '전체 예산', preferences: '여행 취향', transfer: '이동 방법' })[step]; }
