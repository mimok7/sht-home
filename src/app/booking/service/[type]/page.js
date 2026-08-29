'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import BookingCartLink from '@/components/BookingCartLink';
import { getPlatformCartSession, hydrateBookingCart, queueBookingCartItemAfterLogin, replaceBookingCartItem } from '@/lib/booking-cart';
import '../../booking.css';

const SERVICES = {
  cruise_vehicle: { label: '크루즈 차량', example: '하노이 ↔ 하롱 전용 차량' },
  airport: { label: '공항 이동', example: '노이바이 공항 이동' },
  rentcar: { label: '렌터카', example: '기사 포함 전용 차량' },
  tour: { label: '투어', example: '하롱베이 투어' },
  package: { label: '패키지', example: '크루즈 + 호텔 패키지' },
  ticket: { label: '티켓', example: '공연 또는 입장권' },
};

function initialForm(type) {
  const shared = { adults: 2, children: 0, quantity: 1, note: '' };
  if (type === 'airport') return { ...shared, direction: 'both', airport: '노이바이 국제공항', route: '', vehicleType: '', pickupDateTime: '', pickupLocation: '', pickupFlightNumber: '', sendingDateTime: '', sendingLocation: '' };
  if (type === 'cruise_vehicle') return { ...shared, cruiseName: '', wayType: '왕복', route: '', vehicleType: '', pickupDateTime: '', pickupLocation: '', destination: '', returnDateTime: '', returnLocation: '' };
  if (type === 'rentcar') return { ...shared, wayType: '편도', vehicleType: '', pickupDateTime: '', origin: '', destination: '', returnDateTime: '', returnOrigin: '', returnDestination: '' };
  if (type === 'tour') return { ...shared, tourName: '하롱베이 당일 투어', tourStyle: '당일 투어', travelDate: '', pickupHotel: '', pickupTime: '', language: '한국어 안내', mealRequest: '없음' };
  if (type === 'package') return { ...shared, packageName: '크루즈 + 호텔 패키지', startDate: '', endDate: '', roomCount: 1, pickupRequired: false, travelStyle: '휴양', budget: '' };
  return { ...shared, ticketName: '', ticketType: '일반 티켓', useDate: '', shuttleRequired: false, pickupLocation: '', dropoffLocation: '', lobsterCount: 0, fishCount: 0 };
}

function NumberField({ id, label, value, onChange, min = 0, max = 40, required = false }) {
  return <div className="booking-field"><label htmlFor={id}>{label}</label><input id={id} type="number" min={min} max={max} value={value} required={required} onChange={(event) => onChange(event.target.value)} /></div>;
}

function Choice({ selected, onClick, children }) {
  return <button type="button" className={`booking-choice${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onClick}>{children}</button>;
}

function dateFromForm(type, form) {
  if (type === 'airport') return (form.pickupDateTime || form.sendingDateTime || '').slice(0, 10);
  if (type === 'cruise_vehicle' || type === 'rentcar') return (form.pickupDateTime || '').slice(0, 10);
  if (type === 'tour') return form.travelDate;
  if (type === 'package') return form.startDate;
  return form.useDate;
}

function itemName(type, service, form) {
  if (type === 'tour') return form.tourName || service.example;
  if (type === 'package') return form.packageName || service.example;
  if (type === 'ticket') return form.ticketName || service.example;
  if (type === 'cruise_vehicle' && form.cruiseName) return `${form.cruiseName} 차량`;
  return service.example;
}

function summary(type, form) {
  if (type === 'airport') return [['이동 형태', form.direction === 'both' ? '픽업 + 샌딩' : form.direction === 'pickup' ? '픽업' : '샌딩'], ['픽업', form.pickupDateTime || '미정'], ['샌딩', form.sendingDateTime || '미정']];
  if (type === 'cruise_vehicle') return [['이동 방식', form.wayType], ['차량', form.vehicleType || '선택 필요'], ['출발', `${form.pickupDateTime || '미정'} · ${form.pickupLocation || '미정'}`], ['도착', form.destination || '미정']];
  if (type === 'rentcar') return [['이동 방식', form.wayType], ['차량', form.vehicleType || '선택 필요'], ['출발', `${form.pickupDateTime || '미정'} · ${form.origin || '미정'}`], ['도착', form.destination || '미정']];
  if (type === 'tour') return [['이용일', form.travelDate || '미정'], ['투어 유형', form.tourStyle], ['픽업', `${form.pickupTime || '미정'} · ${form.pickupHotel || '미정'}`], ['언어', form.language]];
  if (type === 'package') return [['여행 기간', `${form.startDate || '미정'} ~ ${form.endDate || '미정'}`], ['객실', `${form.roomCount}실`], ['여행 성향', form.travelStyle], ['공항 이동', form.pickupRequired ? '신청' : '미신청']];
  return [['이용일', form.useDate || '미정'], ['티켓 유형', form.ticketType], ['셔틀', form.shuttleRequired ? '신청' : '미신청'], ['메뉴', `${form.lobsterCount || 0} + ${form.fishCount || 0} 선택`]];
}

export default function ServiceDraftPage({ params }) {
  const { type } = use(params);
  const service = SERVICES[type];
  const [form, setForm] = useState(() => initialForm(type));
  const [savedMessage, setSavedMessage] = useState('');
  const [editingCartItemId, setEditingCartItemId] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!service) return;
    const editCartItemId = new URLSearchParams(window.location.search).get('editCartItem');
    if (!editCartItemId) return;
    void hydrateBookingCart().then((cart) => {
      const item = cart.items.find((current) => current.id === editCartItemId && current.serviceType === type);
      if (!item) return;
      setForm({ ...initialForm(type), ...(item.metadata?.form || {}), note: item.metadata?.form?.note || item.metadata?.requestNote || '' });
      setEditingCartItemId(item.id);
    }).catch(() => {});
  }, [service, type]);

  const selection = useMemo(() => service ? summary(type, form) : [], [form, service, type]);
  const participants = Number(form.adults || 0) + Number(form.children || 0);
  if (!service) return <div className="booking-page"><div className="booking-shell"><div className="booking-empty"><h1>서비스를 찾을 수 없습니다.</h1><Link href="/booking">예약 홈으로 →</Link></div></div></div>;

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); setSavedMessage(''); setFormError(''); }
  function participantsFields() { return <div className="booking-field-set"><span className="booking-field-set-label">참가 인원</span><div className="booking-fields"><NumberField id={`${type}-adults`} label="성인" value={form.adults} min={1} required onChange={(value) => update('adults', value)} /><NumberField id={`${type}-children`} label="아동" value={form.children} onChange={(value) => update('children', value)} /></div></div>; }

  async function add(event) {
    event.preventDefault();
    if (type === 'ticket' && Number(form.lobsterCount || 0) + Number(form.fishCount || 0) > participants) { setFormError('메뉴 선택 인원은 총 참가 인원을 초과할 수 없습니다.'); return; }
    const nextItem = {
      id: `${type}:${dateFromForm(type, form) || 'open'}:${itemName(type, service, form)}`,
      serviceType: type, productId: `${type}-request`, name: itemName(type, service, form), optionName: `${service.label} 상세 선택`,
      startDate: dateFromForm(type, form), endDate: type === 'package' ? form.endDate : (form.returnDateTime || '').slice(0, 10),
      adults: Number(form.adults), children: Number(form.children), infants: 0, quantity: type === 'ticket' ? Math.max(1, participants) : Math.max(1, Number(form.quantity || 1)),
      unitPrice: 0, currency: 'VND', priceStatus: 'reference', sourceHref: `/booking/service/${type}`,
      metadata: { form, summary: selection, requestNote: form.note },
    };
    const session = await getPlatformCartSession();
    if (!session) {
      const next = `${window.location.pathname}${window.location.search}`;
      queueBookingCartItemAfterLogin(nextItem, editingCartItemId, next);
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const wasEditing = Boolean(editingCartItemId);
    const savedItem = replaceBookingCartItem(editingCartItemId, nextItem);
    setEditingCartItemId(savedItem.id);
    setSavedMessage(wasEditing ? '선택 내용을 수정하고 장바구니 항목을 교체했습니다.' : '상세 선택을 장바구니에 담았습니다.');
  }

  function fields() {
    if (type === 'airport') return <>
      <div className="booking-step"><span>01 / 이동 형태</span><div className="booking-choice-grid"><Choice selected={form.direction === 'both'} onClick={() => update('direction', 'both')}>픽업 + 샌딩</Choice><Choice selected={form.direction === 'pickup'} onClick={() => update('direction', 'pickup')}>공항 픽업</Choice><Choice selected={form.direction === 'sending'} onClick={() => update('direction', 'sending')}>공항 샌딩</Choice></div></div>
      <div className="booking-fields"><div className="booking-field"><label htmlFor="airport-name">공항</label><input id="airport-name" value={form.airport} onChange={(event) => update('airport', event.target.value)} required /></div><div className="booking-field"><label htmlFor="airport-route">이동 경로</label><input id="airport-route" placeholder="예: 노이바이 ↔ 하노이" value={form.route} onChange={(event) => update('route', event.target.value)} required /></div><div className="booking-field full"><label htmlFor="airport-vehicle">희망 차량</label><select id="airport-vehicle" value={form.vehicleType} onChange={(event) => update('vehicleType', event.target.value)} required><option value="">차량을 선택해 주세요</option><option>세단</option><option>SUV</option><option>승합차</option><option>상담 후 결정</option></select></div></div>
      {(form.direction === 'pickup' || form.direction === 'both') && <div className="booking-field-set"><span className="booking-field-set-label">픽업 정보</span><div className="booking-fields"><div className="booking-field"><label htmlFor="airport-pickup-date">도착 일시</label><input id="airport-pickup-date" type="datetime-local" value={form.pickupDateTime} onChange={(event) => update('pickupDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="airport-flight">항공편명</label><input id="airport-flight" placeholder="예: VN417" value={form.pickupFlightNumber} onChange={(event) => update('pickupFlightNumber', event.target.value)} required /></div><div className="booking-field full"><label htmlFor="airport-pickup-location">목적지 또는 숙소</label><input id="airport-pickup-location" value={form.pickupLocation} onChange={(event) => update('pickupLocation', event.target.value)} required /></div></div></div>}
      {(form.direction === 'sending' || form.direction === 'both') && <div className="booking-field-set"><span className="booking-field-set-label">샌딩 정보</span><div className="booking-fields"><div className="booking-field"><label htmlFor="airport-sending-date">출발 일시</label><input id="airport-sending-date" type="datetime-local" value={form.sendingDateTime} onChange={(event) => update('sendingDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="airport-sending-location">출발 숙소</label><input id="airport-sending-location" value={form.sendingLocation} onChange={(event) => update('sendingLocation', event.target.value)} required /></div></div></div>}{participantsFields()}
    </>;
    if (type === 'cruise_vehicle') return <>
      <div className="booking-step"><span>01 / 이동 방식</span><div className="booking-choice-grid"><Choice selected={form.wayType === '편도'} onClick={() => update('wayType', '편도')}>편도</Choice><Choice selected={form.wayType === '왕복'} onClick={() => update('wayType', '왕복')}>당일 왕복</Choice><Choice selected={form.wayType === '다른날왕복'} onClick={() => update('wayType', '다른날왕복')}>다른 날 왕복</Choice></div></div>
      <div className="booking-fields"><div className="booking-field"><label htmlFor="cruise-name">크루즈명</label><input id="cruise-name" value={form.cruiseName} onChange={(event) => update('cruiseName', event.target.value)} required /></div><div className="booking-field"><label htmlFor="cruise-route">이동 경로</label><input id="cruise-route" placeholder="예: 하노이 ↔ 투안차우" value={form.route} onChange={(event) => update('route', event.target.value)} required /></div><div className="booking-field"><label htmlFor="cruise-vehicle">차량 유형</label><select id="cruise-vehicle" value={form.vehicleType} onChange={(event) => update('vehicleType', event.target.value)} required><option value="">선택해 주세요</option><option>전용 세단</option><option>전용 SUV</option><option>전용 승합차</option><option>셔틀 리무진</option></select></div><div className="booking-field"><label htmlFor="cruise-date">출발 일시</label><input id="cruise-date" type="datetime-local" value={form.pickupDateTime} onChange={(event) => update('pickupDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="cruise-pickup">출발 장소</label><input id="cruise-pickup" value={form.pickupLocation} onChange={(event) => update('pickupLocation', event.target.value)} required /></div><div className="booking-field"><label htmlFor="cruise-destination">도착 장소</label><input id="cruise-destination" value={form.destination} onChange={(event) => update('destination', event.target.value)} required /></div></div>
      {form.wayType !== '편도' && <div className="booking-field-set"><span className="booking-field-set-label">귀환 일정</span><div className="booking-fields"><div className="booking-field"><label htmlFor="cruise-return-date">귀환 일시</label><input id="cruise-return-date" type="datetime-local" value={form.returnDateTime} onChange={(event) => update('returnDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="cruise-return-location">귀환 장소</label><input id="cruise-return-location" value={form.returnLocation} onChange={(event) => update('returnLocation', event.target.value)} required /></div></div></div>}{participantsFields()}
    </>;
    if (type === 'rentcar') return <>
      <div className="booking-step"><span>01 / 이용 방식</span><div className="booking-choice-grid"><Choice selected={form.wayType === '편도'} onClick={() => update('wayType', '편도')}>편도</Choice><Choice selected={form.wayType === '당일왕복'} onClick={() => update('wayType', '당일왕복')}>당일 왕복</Choice><Choice selected={form.wayType === '다른날왕복'} onClick={() => update('wayType', '다른날왕복')}>다른 날 왕복</Choice></div></div>
      <div className="booking-fields"><div className="booking-field"><label htmlFor="rentcar-type">차량 유형</label><select id="rentcar-type" value={form.vehicleType} onChange={(event) => update('vehicleType', event.target.value)} required><option value="">선택해 주세요</option><option>세단</option><option>SUV</option><option>승합차</option><option>리무진</option></select></div><div className="booking-field"><label htmlFor="rentcar-date">픽업 일시</label><input id="rentcar-date" type="datetime-local" value={form.pickupDateTime} onChange={(event) => update('pickupDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="rentcar-origin">출발지</label><input id="rentcar-origin" value={form.origin} onChange={(event) => update('origin', event.target.value)} required /></div><div className="booking-field"><label htmlFor="rentcar-destination">목적지</label><input id="rentcar-destination" value={form.destination} onChange={(event) => update('destination', event.target.value)} required /></div></div>
      {form.wayType !== '편도' && <div className="booking-field-set"><span className="booking-field-set-label">귀환 일정</span><div className="booking-fields"><div className="booking-field"><label htmlFor="rentcar-return-date">귀환 일시</label><input id="rentcar-return-date" type="datetime-local" value={form.returnDateTime} onChange={(event) => update('returnDateTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="rentcar-return-origin">귀환 출발지</label><input id="rentcar-return-origin" value={form.returnOrigin} onChange={(event) => update('returnOrigin', event.target.value)} required /></div><div className="booking-field full"><label htmlFor="rentcar-return-destination">귀환 목적지</label><input id="rentcar-return-destination" value={form.returnDestination} onChange={(event) => update('returnDestination', event.target.value)} required /></div></div></div>}{participantsFields()}
    </>;
    if (type === 'tour') return <><div className="booking-fields"><div className="booking-field full"><label htmlFor="tour-name">투어명</label><input id="tour-name" value={form.tourName} onChange={(event) => update('tourName', event.target.value)} required /></div><div className="booking-field"><label htmlFor="tour-style">투어 유형</label><select id="tour-style" value={form.tourStyle} onChange={(event) => update('tourStyle', event.target.value)}><option>당일 투어</option><option>반일 투어</option><option>야간 투어</option><option>맞춤 투어</option></select></div><div className="booking-field"><label htmlFor="tour-date">이용일</label><input id="tour-date" type="date" value={form.travelDate} onChange={(event) => update('travelDate', event.target.value)} required /></div><div className="booking-field"><label htmlFor="tour-hotel">픽업 숙소</label><input id="tour-hotel" value={form.pickupHotel} onChange={(event) => update('pickupHotel', event.target.value)} required /></div><div className="booking-field"><label htmlFor="tour-time">픽업 희망 시간</label><input id="tour-time" type="time" value={form.pickupTime} onChange={(event) => update('pickupTime', event.target.value)} required /></div><div className="booking-field"><label htmlFor="tour-language">안내 언어</label><select id="tour-language" value={form.language} onChange={(event) => update('language', event.target.value)}><option>한국어 안내</option><option>영어 안내</option><option>언어 무관</option></select></div><div className="booking-field"><label htmlFor="tour-meal">식사 요청</label><select id="tour-meal" value={form.mealRequest} onChange={(event) => update('mealRequest', event.target.value)}><option>없음</option><option>채식</option><option>알레르기 안내 필요</option><option>상담 후 결정</option></select></div></div>{participantsFields()}</>;
    if (type === 'package') return <><div className="booking-fields"><div className="booking-field full"><label htmlFor="package-name">희망 패키지</label><input id="package-name" value={form.packageName} onChange={(event) => update('packageName', event.target.value)} required /></div><div className="booking-field"><label htmlFor="package-start">여행 시작일</label><input id="package-start" type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} required /></div><div className="booking-field"><label htmlFor="package-end">여행 종료일</label><input id="package-end" type="date" min={form.startDate} value={form.endDate} onChange={(event) => update('endDate', event.target.value)} required /></div><NumberField id="package-room-count" label="객실 수" value={form.roomCount} min={1} max={10} required onChange={(value) => update('roomCount', value)} /><div className="booking-field"><label htmlFor="package-style">여행 성향</label><select id="package-style" value={form.travelStyle} onChange={(event) => update('travelStyle', event.target.value)}><option>휴양</option><option>관광</option><option>가족 여행</option><option>허니문</option><option>맞춤 여행</option></select></div><div className="booking-field full"><label htmlFor="package-budget">예상 예산</label><input id="package-budget" placeholder="예: 1인 10,000,000 VND 또는 상담 후 결정" value={form.budget} onChange={(event) => update('budget', event.target.value)} /></div></div><label className="booking-check"><input type="checkbox" checked={form.pickupRequired} onChange={(event) => update('pickupRequired', event.target.checked)} />공항 이동도 함께 준비할게요.</label>{participantsFields()}</>;
    return <><div className="booking-fields"><div className="booking-field"><label htmlFor="ticket-type">티켓 유형</label><select id="ticket-type" value={form.ticketType} onChange={(event) => update('ticketType', event.target.value)}><option>일반 티켓</option><option>드래곤펄 크루즈</option><option>요코 온센</option><option>기타 입장권</option></select></div><div className="booking-field"><label htmlFor="ticket-date">이용일</label><input id="ticket-date" type="date" value={form.useDate} onChange={(event) => update('useDate', event.target.value)} required /></div><div className="booking-field full"><label htmlFor="ticket-name">공연·입장권명</label><input id="ticket-name" placeholder="예: 드래곤펄 디너 크루즈" value={form.ticketName} onChange={(event) => update('ticketName', event.target.value)} required /></div></div>{participantsFields()}{form.ticketType === '드래곤펄 크루즈' && <div className="booking-field-set"><span className="booking-field-set-label">드래곤펄 메뉴</span><div className="booking-fields"><NumberField id="ticket-lobster" label="랍스터 메뉴" value={form.lobsterCount} onChange={(value) => update('lobsterCount', value)} /><NumberField id="ticket-fish" label="생선 메뉴" value={form.fishCount} onChange={(value) => update('fishCount', value)} /></div><p className="booking-inline-note">메뉴 선택 {Number(form.lobsterCount || 0) + Number(form.fishCount || 0)}명 / 참가 인원 {participants}명</p></div>}<label className="booking-check"><input type="checkbox" checked={form.shuttleRequired} onChange={(event) => update('shuttleRequired', event.target.checked)} />셔틀 차량을 함께 신청할게요.</label>{form.shuttleRequired && <div className="booking-fields"><div className="booking-field"><label htmlFor="ticket-pickup">픽업 장소</label><input id="ticket-pickup" value={form.pickupLocation} onChange={(event) => update('pickupLocation', event.target.value)} required /></div><div className="booking-field"><label htmlFor="ticket-dropoff">하차 장소</label><input id="ticket-dropoff" value={form.dropoffLocation} onChange={(event) => update('dropoffLocation', event.target.value)} required /></div></div>}</>;
  }

  return <div className="booking-page"><div className="booking-shell"><Link href="/booking" className="booking-back">← 전체 서비스</Link><div className="booking-title-row"><div><span className="booking-section-kicker">TRAVEL RESERVATION</span><h1>{service.label}</h1></div><BookingCartLink className="beta-badge" header={false}>장바구니</BookingCartLink></div><form className="service-flow" onSubmit={add}><section className="booking-panel"><div className="booking-panel-head"><span>01 / RESERVATION DETAILS</span><h2>여행 조건 선택</h2><p>플랫폼 고객 앱의 서비스별 필수 조건을 같은 순서로 작성해 주세요.</p></div><div className="booking-panel-body">{fields()}<div className="booking-field full"><label htmlFor={`${type}-note`}>요청사항</label><textarea id={`${type}-note`} value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="유아 카시트, 짐, 기념일, 알레르기 등 필요한 내용을 적어주세요." /></div></div></section><aside className="service-selection-summary"><div><span>02 / SELECTION SUMMARY</span><h2>선택 내용</h2></div><dl>{selection.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}<div><dt>참가 인원</dt><dd>성인 {form.adults}명 · 아동 {form.children}명</dd></div></dl><p>금액과 가능 여부는 예약 요청 전에 최신 상품 정보로 다시 확인합니다.</p></aside>{formError && <p className="booking-error" role="alert">{formError}</p>}{savedMessage && <p className="booking-warning" role="status">{savedMessage}</p>}<div className="booking-controls"><button type="submit">{editingCartItemId ? '선택 수정 저장 →' : '장바구니에 담기 →'}</button><BookingCartLink className="secondary" showCount={false} header={false}>장바구니 보기 →</BookingCartLink></div></form></div></div>;
}
