'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';

const TYPE_LABEL = { cruise: '크루즈', cruise_car: '크루즈 차량', car: '차량', airport: '공항 이동', hotel: '호텔', rentcar: '렌터카', tour: '투어', package: '패키지', ticket: '티켓', sht: '스하 차량', sht_car: '스하 차량' };
const STATUS_LABEL = { pending: '접수 대기', approved: '예약 승인', confirmed: '예약 확정', cancelled: '취소', rejected: '반려', completed: '완료' };
const PAYMENT_LABEL = { pending: '결제 대기', completed: '결제 완료', paid: '결제 완료', failed: '결제 실패', refunded: '환불 완료', cancelled: '결제 취소' };
const DETAIL_CONFIG = {
  cruise: { table: 'reservation_cruise', fields: [['checkin', '승선일'], ['checkout', '하선일'], ['guest_count', '총 인원'], ['adult_count', '성인'], ['child_count', '아동'], ['infant_count', '유아'], ['room_count', '객실 수'], ['boarding_assist', '승선 지원'], ['boarding_code', '승선 코드'], ['request_note', '요청사항']] },
  airport: { table: 'reservation_airport', fields: [['route', '경로'], ['vehicle_type', '차량 타입'], ['accommodation_info', '장소'], ['ra_airport_location', '공항'], ['ra_flight_number', '항공편'], ['ra_datetime', '이용 일시'], ['ra_stopover_location', '경유지'], ['ra_stopover_wait_minutes', '경유 대기 시간'], ['ra_car_count', '차량 수'], ['ra_passenger_count', '승객 수'], ['ra_luggage_count', '수하물 수'], ['dispatch_code', '차량번호'], ['request_note', '요청사항']] },
  hotel: { table: 'reservation_hotel', fields: [['hotel_name', '호텔명'], ['room_name', '객실명'], ['checkin_date', '체크인'], ['checkout_date', '체크아웃'], ['guest_count', '총 인원'], ['schedule', '숙박 일정'], ['breakfast_service', '조식'], ['hotel_category', '호텔 등급'], ['assignment_code', '호텔 코드'], ['request_note', '요청사항']] },
  rentcar: { table: 'reservation_rentcar', fields: [['way_type', '이용 방식'], ['route', '경로'], ['vehicle_type', '차종'], ['pickup_datetime', '픽업 시간'], ['pickup_location', '승차 위치'], ['destination', '하차 위치'], ['via_location', '경유지'], ['via_waiting', '경유 대기'], ['car_count', '차량 수'], ['passenger_count', '탑승 인원'], ['luggage_count', '수하물'], ['dispatch_code', '차량번호'], ['request_note', '요청사항']] },
  tour: { table: 'reservation_tour', fields: [['tour_name', '투어명'], ['tour_vehicle', '차량'], ['tour_type', '투어 타입'], ['usage_date', '투어 날짜'], ['tour_capacity', '인원'], ['pickup_location', '픽업 장소'], ['dropoff_location', '하차 장소'], ['request_note', '요청사항']] },
  ticket: { table: 'reservation_ticket', fields: [['ticket_type', '티켓 유형'], ['ticket_name', '티켓명'], ['program_selection', '프로그램'], ['usage_date', '이용 날짜'], ['ticket_quantity', '수량'], ['shuttle_required', '셔틀 신청'], ['pickup_location', '픽업 장소'], ['dropoff_location', '하차 장소'], ['ticket_details', '상세 내용'], ['special_requests', '추가 요청사항'], ['request_note', '요청사항']] },
  cruise_car: { table: 'reservation_cruise_car', fields: [['way_type', '이용 방식'], ['route', '경로'], ['vehicle_type', '차종'], ['pickup_datetime', '픽업 시간'], ['pickup_location', '승차 위치'], ['dropoff_location', '하차 위치'], ['car_count', '차량 수'], ['passenger_count', '탑승 인원'], ['dispatch_code', '차량번호'], ['request_note', '요청사항']] },
  car: { table: 'reservation_cruise_car', fields: [['way_type', '이용 방식'], ['route', '경로'], ['vehicle_type', '차종'], ['pickup_datetime', '픽업 시간'], ['pickup_location', '승차 위치'], ['dropoff_location', '하차 위치'], ['car_count', '차량 수'], ['passenger_count', '탑승 인원'], ['dispatch_code', '차량번호'], ['request_note', '요청사항']] },
  sht: { table: 'reservation_car_sht', fields: [['vehicle_number', '차량번호'], ['seat_number', '좌석번호'], ['car_type', '차종'], ['usage_date', '사용일'], ['pickup_location', '승차 위치'], ['dropoff_location', '하차 위치'], ['passenger_count', '승객 수'], ['request_note', '요청사항']] },
  sht_car: { table: 'reservation_car_sht', fields: [['vehicle_number', '차량번호'], ['seat_number', '좌석번호'], ['car_type', '차종'], ['usage_date', '사용일'], ['pickup_location', '승차 위치'], ['dropoff_location', '하차 위치'], ['passenger_count', '승객 수'], ['request_note', '요청사항']] },
  package: { table: 'reservation_package', fields: [['package_name', '패키지명'], ['start_date', '여행 시작일'], ['end_date', '여행 종료일'], ['guest_count', '총 인원'], ['request_note', '요청사항']] },
};

function isPresent(value) { return value !== null && value !== undefined && value !== ''; }
function toAmount(value) { const amount = Number(value); return Number.isFinite(amount) ? amount : null; }
function formatAmount(value) { const amount = toAmount(value); return amount === null ? '확인 중' : `${amount.toLocaleString('ko-KR')} VND`; }
function formatDate(value, withTime = false) {
  if (!value) return '확인 중';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
function formatValue(key, value) {
  if (typeof value === 'boolean') return value ? '신청' : '미신청';
  if (/(date|datetime|checkin|checkout|usage)/i.test(key)) return formatDate(value, /time|datetime/i.test(key));
  if (typeof value === 'number') return value.toLocaleString('ko-KR');
  return String(value);
}
function paymentMethodLabel(value) { return ({ onepay: 'OnePay', bank_transfer: '계좌이체', card: '카드', cash: '현장 결제', virtual: '가상결제' })[value] || value || '매니저 안내 전'; }
function detailEntries(record) {
  const fields = DETAIL_CONFIG[record.re_type]?.fields || [];
  return (record.details || []).flatMap((detail, index) => fields.filter(([key]) => isPresent(detail[key])).map(([key, label]) => ({ key: `${index}-${key}`, label: record.details.length > 1 ? `${label} ${index + 1}` : label, value: formatValue(key, detail[key]) })));
}
function paymentFor(record) { return record.payment || null; }
function paidAmount(record) {
  const stored = toAmount(record.paid_amount);
  if (stored !== null && stored > 0) return stored;
  const payment = paymentFor(record);
  return ['completed', 'paid'].includes(payment?.payment_status || record.payment_status) ? toAmount(payment?.amount) || 0 : 0;
}

async function loadBundle(reservationId) {
  const { data: auth, error: authError } = await platformSupabase.auth.getUser();
  if (authError || !auth.user) return { needsLogin: true };
  const fields = 're_id,re_type,re_status,re_created_at,re_quote_id,re_user_id,total_amount,paid_amount,payment_status,reservation_date,pax_count,manager_note';
  const { data: focus, error } = await platformSupabase.from('reservation').select(fields).eq('re_id', reservationId).eq('re_user_id', auth.user.id).maybeSingle();
  if (error) throw error;
  if (!focus) throw new Error('예약이 없거나 접근 권한이 없습니다.');
  let records = [focus];
  if (focus.re_quote_id) {
    const { data, error: groupError } = await platformSupabase.from('reservation').select(fields).eq('re_quote_id', focus.re_quote_id).eq('re_user_id', auth.user.id).order('re_created_at', { ascending: true });
    if (groupError) throw groupError;
    if (data?.length) records = data;
  }
  const ids = records.map((record) => record.re_id);
  const [{ data: profile }, paymentResult, confirmationResult] = await Promise.all([
    platformSupabase.from('users').select('name,english_name,email,phone_number').eq('id', auth.user.id).maybeSingle(),
    platformSupabase.from('reservation_payment').select('reservation_id,payment_status,amount,payment_method,created_at').in('reservation_id', ids).order('created_at', { ascending: false }),
    platformSupabase.from('confirmation_status').select('reservation_id,status,generated_at,sent_at').in('reservation_id', [...ids, focus.re_quote_id].filter(Boolean)),
  ]);
  const latestPayments = new Map();
  (paymentResult.data || []).forEach((payment) => { if (!latestPayments.has(payment.reservation_id)) latestPayments.set(payment.reservation_id, payment); });
  const confirmations = confirmationResult.data || [];
  const details = await Promise.all(records.map(async (record) => {
    const config = DETAIL_CONFIG[record.re_type];
    if (!config) return { ...record, details: [], payment: latestPayments.get(record.re_id) || null };
    const { data } = await platformSupabase.from(config.table).select('*').eq('reservation_id', record.re_id).order('created_at', { ascending: false });
    return { ...record, details: data || [], payment: latestPayments.get(record.re_id) || null };
  }));
  return { focusId: focus.re_id, records: details, profile: profile || { name: auth.user.user_metadata?.name || '', email: auth.user.email || '', phone_number: '' }, confirmation: confirmations.find((item) => item.reservation_id === focus.re_quote_id) || confirmations.find((item) => item.reservation_id === focus.re_id) || null };
}

function useReservationBundle(reservationId, confirmation) {
  const [state, setState] = useState({ loading: true, error: '', bundle: null });
  useEffect(() => {
    let cancelled = false;
    loadBundle(reservationId).then((bundle) => {
      if (cancelled) return;
      if (bundle.needsLogin) { window.location.replace(`/login?next=${encodeURIComponent(`/booking/reservations/${reservationId}${confirmation ? '/confirmation' : ''}`)}`); return; }
      setState({ loading: false, error: '', bundle });
    }).catch(() => { if (!cancelled) setState({ loading: false, error: '예약 정보를 불러오지 못했습니다. 기존 예약 플랫폼에서 확인해 주세요.', bundle: null }); });
    return () => { cancelled = true; };
  }, [reservationId, confirmation]);
  return state;
}

function ReservationAmounts({ record }) {
  const total = toAmount(record.total_amount);
  const paid = paidAmount(record);
  const balance = total === null ? null : Math.max(total - paid, 0);
  return <dl className="reservation-amounts"><div><dt>예약 합계</dt><dd>{formatAmount(record.total_amount)}</dd></div><div><dt>결제 완료 금액</dt><dd>{formatAmount(paid)}</dd></div><div><dt>결제 잔액</dt><dd>{balance === null ? '확인 중' : formatAmount(balance)}</dd></div></dl>;
}

function RecordDetail({ record, confirmationLink }) {
  const entries = detailEntries(record);
  const payment = paymentFor(record);
  return <section className="reservation-service-detail">
    <header><div><span>{TYPE_LABEL[record.re_type] || record.re_type}</span><h2>{TYPE_LABEL[record.re_type] || '여행'} 예약 상세</h2></div><div className="reservation-status"><strong>{STATUS_LABEL[record.re_status] || record.re_status}</strong><span>{PAYMENT_LABEL[payment?.payment_status || record.payment_status] || payment?.payment_status || record.payment_status}</span></div></header>
    <dl className="reservation-details"><div><dt>이용 예정일</dt><dd>{formatDate(record.reservation_date)}</dd></div><div><dt>예약 접수일</dt><dd>{formatDate(record.re_created_at, true)}</dd></div><div><dt>여행 인원</dt><dd>{record.pax_count || '—'}명</dd></div><div><dt>예약번호</dt><dd>{String(record.re_id).slice(0, 8).toUpperCase()}</dd></div></dl>
    {entries.length > 0 && <dl className="reservation-service-fields">{entries.map((entry) => <div key={entry.key}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}
    <ReservationAmounts record={record} />
    <div className="reservation-payment-note"><span>결제 기록</span><strong>{payment ? `${paymentMethodLabel(payment.payment_method)} · ${formatDate(payment.created_at, true)}` : '매니저 결제 안내 전'}</strong></div>
    {isPresent(record.manager_note) && <p className="reservation-manager-note"><b>안내 메모</b>{record.manager_note}</p>}
    {confirmationLink && <div className="reservation-detail-actions"><Link className="booking-action primary" href={confirmationLink}>예약 확인서 보기 →</Link></div>}
  </section>;
}

function LoadingOrError({ state }) {
  if (state.loading) return <div className="booking-empty"><h2>예약 정보를 확인하고 있습니다.</h2><p>플랫폼 원장에서 고객님의 예약을 안전하게 조회합니다.</p></div>;
  if (state.error) return <div className="booking-empty"><h2>확인이 필요합니다.</h2><p>{state.error}</p><a className="booking-action primary" href="https://customer.stayhalong.com/mypage/reservations" target="_blank" rel="noreferrer">기존 플랫폼에서 확인 ↗</a></div>;
  return null;
}

export function ReservationDetailView({ reservationId }) {
  const state = useReservationBundle(reservationId, false);
  const record = state.bundle?.records.find((item) => item.re_id === state.bundle.focusId);
  return <div className="booking-page"><div className="booking-shell"><Link href="/booking/reservations" className="booking-back">← 내 예약</Link><div className="booking-title-row"><div><span className="booking-section-kicker">RESERVATION DETAIL</span><h1>예약 상세</h1></div><span className="beta-badge">PLATFORM SHARED DATA</span></div><LoadingOrError state={state} />{record && <RecordDetail record={record} confirmationLink={`/booking/reservations/${record.re_id}/confirmation`} />}</div></div>;
}

export function ReservationConfirmationView({ reservationId }) {
  const state = useReservationBundle(reservationId, true);
  const records = state.bundle?.records || [];
  const total = records.reduce((sum, record) => sum + (toAmount(record.total_amount) || 0), 0);
  const paid = records.reduce((sum, record) => sum + paidAmount(record), 0);
  return <div className="booking-page"><div className="booking-shell"><Link href={`/booking/reservations/${reservationId}`} className="booking-back">← 예약 상세</Link><LoadingOrError state={state} />{state.bundle && <article className="reservation-confirmation"><header className="confirmation-header"><div><span>STAY HALONG</span><h1>예약 확인서</h1><p>RESERVATION CONFIRMATION</p></div><dl><div><dt>확인서 번호</dt><dd>{String(state.bundle.confirmation?.reservation_id || state.bundle.records[0]?.re_quote_id || reservationId).slice(-8).toUpperCase()}</dd></div><div><dt>발행일</dt><dd>{formatDate(state.bundle.confirmation?.generated_at || new Date().toISOString())}</dd></div></dl></header><p className="confirmation-note">이 문서는 플랫폼 예약 원장을 조회해 표시합니다. 최종 확정 여부와 결제 안내는 아래 상태를 확인해 주세요.</p><section className="confirmation-summary"><h2>예약자 및 기본 정보</h2><dl><div><dt>예약자</dt><dd>{state.bundle.profile.english_name || state.bundle.profile.name || '확인 중'}</dd></div><div><dt>이메일</dt><dd>{state.bundle.profile.email || '확인 중'}</dd></div><div><dt>연락처</dt><dd>{state.bundle.profile.phone_number || '확인 중'}</dd></div><div><dt>서비스</dt><dd>{records.map((record) => TYPE_LABEL[record.re_type] || record.re_type).join(' · ')}</dd></div></dl></section><section className="confirmation-services"><h2>예약 서비스</h2>{records.map((record) => <RecordDetail key={record.re_id} record={record} />)}</section><section className="confirmation-total"><span>총 예약 금액</span><strong>{formatAmount(total)}</strong><span>결제 완료 금액</span><strong>{formatAmount(paid)}</strong><span>결제 잔액</span><strong>{formatAmount(Math.max(total - paid, 0))}</strong></section><div className="booking-warning">결제 링크는 매니저가 기존 플랫폼에서 발급합니다. 이 확인서의 결제 상태는 플랫폼 원장에 반영된 정보입니다.</div></article>}</div></div>;
}
