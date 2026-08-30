'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../booking.css';

const TYPE_LABEL = { cruise: '크루즈', cruise_car: '크루즈 차량', car: '차량', airport: '공항 이동', hotel: '호텔', rentcar: '렌터카', tour: '투어', package: '패키지', ticket: '티켓' };
const PAYMENT_LABEL = { pending: '결제 대기', completed: '결제 완료', paid: '결제 완료', failed: '결제 실패', refunded: '환불 완료', cancelled: '결제 취소' };
const TYPE_ORDER = { cruise: 1, airport: 2, tour: 3, rentcar: 4, hotel: 5 };

function formatDate(value) {
  if (!value) return '일정 확인 중';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '일정 확인 중' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString('ko-KR')} VND` : '매니저 확인 중';
}

export default function ReservationListPage() {
  const [state, setState] = useState({ loading: true, error: '', reservations: [] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: auth, error: authError } = await platformSupabase.auth.getUser();
      if (cancelled) return;
      if (authError || !auth.user) {
        const next = encodeURIComponent('/booking/reservations');
        window.location.replace(`/login?next=${next}`);
        return;
      }
      const { data: reservations, error } = await platformSupabase
        .from('reservation')
        .select('re_id,re_type,re_status,re_created_at,total_amount,paid_amount,payment_status,reservation_date,pax_count')
        .eq('re_user_id', auth.user.id)
        .order('re_created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setState({ loading: false, error: '예약 내역을 불러오지 못했습니다. 기존 예약 플랫폼에서 확인해 주세요.', reservations: [] });
        return;
      }
      const ids = (reservations || []).map((item) => item.re_id);
      let payments = [];
      if (ids.length) {
        const paymentResult = await platformSupabase
          .from('reservation_payment')
          .select('reservation_id,payment_status,amount,payment_method,created_at')
          .in('reservation_id', ids)
          .order('created_at', { ascending: false });
        payments = paymentResult.data || [];
      }
      const latestPayment = new Map();
      payments.forEach((payment) => { if (!latestPayment.has(payment.reservation_id)) latestPayment.set(payment.reservation_id, payment); });
      if (!cancelled) {
        const orderedReservations = (reservations || [])
          .map((item) => ({ ...item, payment: latestPayment.get(item.re_id) || null }))
          .sort((left, right) => (TYPE_ORDER[left.re_type] || 99) - (TYPE_ORDER[right.re_type] || 99));
        setState({ loading: false, error: '', reservations: orderedReservations });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return <div className="booking-page"><div className="booking-shell">
    <Link href="/booking" className="booking-back">← 예약 홈</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">MY JOURNEY</span><h1>내 예약</h1></div><span className="beta-badge">PLATFORM SHARED DATA</span></div>
    {state.loading && <div className="booking-empty"><h2>예약을 확인하고 있습니다.</h2><p>플랫폼 원장에서 고객님의 예약을 안전하게 조회합니다.</p></div>}
    {state.error && <div className="booking-empty"><h2>확인이 필요합니다.</h2><p>{state.error}</p><a className="booking-action primary" href="https://customer.stayhalong.com/mypage/reservations" target="_blank" rel="noreferrer">기존 플랫폼에서 확인 ↗</a></div>}
    {!state.loading && !state.error && state.reservations.length === 0 && <div className="booking-empty"><h2>아직 예약이 없습니다.</h2><p>원하는 여행 상품을 고르면 이곳에서 진행 상태를 확인할 수 있습니다.</p><Link className="booking-action primary" href="/booking">예약 시작하기 →</Link></div>}
    {!state.loading && !state.error && state.reservations.length > 0 && <div className="reservation-list">
      {state.reservations.map((reservation) => {
        const paymentStatus = reservation.payment?.payment_status || reservation.payment_status || 'pending';
        const paymentLabel = PAYMENT_LABEL[paymentStatus] || paymentStatus;
        return <article className="reservation-item" key={reservation.re_id}>
          <div className="reservation-type"><span className="reservation-type-desktop">{TYPE_LABEL[reservation.re_type] || reservation.re_type}</span><span className="reservation-type-mobile">{TYPE_LABEL[reservation.re_type] || '여행'} 예약 <small>({paymentLabel})</small></span></div>
          <div className="reservation-item-content"><h2 className="reservation-item-title">{TYPE_LABEL[reservation.re_type] || '여행'} 예약 <small>({paymentLabel})</small></h2><div className="reservation-meta"><span>이용일 {formatDate(reservation.reservation_date)}</span><span>인원 {reservation.pax_count || '—'}명</span><span>예약번호 {String(reservation.re_id).slice(0, 8)}</span><span className="reservation-amount">{formatAmount(reservation.total_amount)}</span></div>
            <div className="reservation-detail-actions"><Link className="booking-action secondary" href={`/booking/reservations/${reservation.re_id}`}>상세 보기 →</Link><Link className="booking-action primary" href={`/booking/reservations/${reservation.re_id}/confirmation`}>예약 확인서 →</Link></div>
          </div>
        </article>;
      })}
    </div>}
    <div className="booking-warning">결제 링크는 현재와 같이 매니저가 기존 플랫폼에서 발급합니다. 결제 완료 상태는 플랫폼 원장에 반영된 뒤 이 화면에 표시됩니다.</div>
  </div></div>;
}
