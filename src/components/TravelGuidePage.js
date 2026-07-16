'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './TravelGuidePage.module.css';

const KAKAO_CHAT_URL = 'http://pf.kakao.com/_zvsxaG/chat';
const DEFAULT_CONTEXT = { scheduleType: '', checkinDate: null, adults: 2, children: 0, infants: 0, childAges: [], roomCount: 1, roomPreference: 'standard', totalBudgetVnd: null, preferences: [], transfer: 'later' };
const LABELS = {
  scheduleType: { DAY: '당일 크루즈', '1N2D': '1박 2일', '2N3D': '2박 3일' },
  roomPreference: { standard: '일반 객실', triple: '트리플', connecting: '커넥팅', extra_bed: '엑스트라베드', single: '싱글룸' },
  preference: { family: '가족 편의', couple: '허니문·커플', balcony: '전용 발코니', activity: '시설·액티비티', value: '합리적인 가격', luxury: 'VIP 서비스' },
  transfer: { none: '이동 불필요', hanoi: '하노이 왕복', airport: '공항 이동', local: '하롱 현지 합류', later: '나중에 결정' },
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

  const steps = useMemo(() => ['schedule', 'date', 'party', ...(context.children ? ['ages'] : []), ...(context.scheduleType !== 'DAY' ? ['room'] : []), 'budget', 'preferences', 'transfer', 'review'], [context.children, context.scheduleType]);
  const stepIndex = Math.max(0, steps.indexOf(currentStep));
  const update = (values) => setContext((previous) => ({ ...previous, ...values }));
  const next = () => setCurrentStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const back = () => setCurrentStep(steps[Math.max(stepIndex - 1, 0)]);
  const choose = (values, nextStep) => { update(values); setCurrentStep(nextStep); setResult(null); setError(''); };

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
    <section className={styles.hero}><div><p>LOCAL DESK / CRUISE FINDER</p><h1>내 여행에 맞는<br /><span>크루즈 찾기.</span></h1><strong>DATE · PARTY · ROOM · BUDGET · STYLE</strong></div><aside><b>01</b><p>한 번에 하나씩 답하면 실제 객실과 활성 요금을 기준으로 후보를 좁혀드립니다.</p></aside></section>
    <section className={styles.content} aria-label="하롱 크루즈 맞춤 추천"><aside className={styles.notes}><p>YOUR JOURNEY</p><ol>{steps.slice(0, -1).map((step, index) => <li key={step} className={index === stepIndex ? styles.current : index < stepIndex ? styles.done : ''}><b>{String(index + 1).padStart(2, '0')}</b>{stepLabel(step)}</li>)}</ol><a href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">바로 카카오 상담 <span>↗</span></a></aside><div className={styles.chat}><header><p>STEP {String(stepIndex + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</p><div className={styles.progress}><i style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div></header><div className={styles.conversation} aria-live="polite">{question}{stepIndex > 0 && currentStep !== 'review' && <button type="button" className={styles.back} onClick={back}>← 이전 질문</button>}{error && <p className={styles.error}>{error}</p>}{result && <RecommendationResult result={result} onReset={reset} />}</div></div></section>
  </main>;
}

function Question({ title, description }) { return <div className={styles.question}><h2>{title}</h2><p>{description}</p></div>; }
function Options({ options, onSelect, selected }) { return <div className={styles.options}>{options.map(([value, label, detail]) => <button type="button" key={String(value)} className={selected === value ? styles.selected : ''} onClick={() => onSelect(value)}><span><b>{label}</b><small>{detail}</small></span><i>→</i></button>)}</div>; }
function Continue({ onClick, label = '다음 질문' }) { return <button type="button" className={styles.continueButton} onClick={onClick}>{label}<span>→</span></button>; }
function Summary({ label, value, onEdit }) { return <div><span>{label}</span><b>{value}</b><button type="button" onClick={onEdit}>수정</button></div>; }
function RecommendationResult({ result, onReset }) { return <article className={styles.results}><div className={styles.resultIntro}><p>{result.agent}</p><strong>{result.answer}</strong></div>{result.recommendations.map((cruise, index) => <Link className={styles.resultCard} key={cruise.href} href={cruise.href}><span>{String(index + 1).padStart(2, '0')} / {cruise.duration}</span><h3>{cruise.name}</h3><p>{cruise.cabinName}</p><strong>{cruise.registeredPriceLabel}</strong>{cruise.referenceTotalLabel && <small>{cruise.referenceTotalLabel}</small>}<ul>{cruise.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div><b>확인 필요</b>{cruise.confirmations.join(' · ')}</div></Link>)}{!result.recommendations.length && <a className={styles.kakaoResult} href={KAKAO_CHAT_URL} target="_blank" rel="noreferrer">현지 데스크에 조건 확인 <span>↗</span></a>}<button type="button" className={styles.restart} onClick={onReset}>조건 다시 선택하기</button></article>; }
function stepLabel(step) { return ({ schedule: '여행 일정', date: '출발일', party: '여행 인원', ages: '아동 나이', room: '객실 구성', budget: '전체 예산', preferences: '여행 취향', transfer: '이동 방법' })[step]; }
