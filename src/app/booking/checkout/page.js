'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import { bookingCartTotal, hydrateBookingCart, readBookingCart } from '@/lib/booking-cart';
import '../booking.css';

export default function BookingCheckoutPage() {
  const [state, setState] = useState({ loading: true, user: null, items: [], payments: [], error: '' });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const localItems = readBookingCart();
      const { data: auth, error: authError } = await platformSupabase.auth.getUser();
      if (cancelled) return;
      if (authError || !auth.user) {
        window.location.replace(`/login?next=${encodeURIComponent('/booking/checkout')}`);
        return;
      }
      const cart = await hydrateBookingCart();
      const items = cart.items.length || cart.synced ? cart.items : localItems;
      const { data: reservations, error } = await platformSupabase.from('reservation').select('re_id,re_type,re_status,total_amount,payment_status,re_quote_id').eq('re_user_id', auth.user.id).order('re_created_at', { ascending: false });
      if (cancelled) return;
      if (error) { setState({ loading: false, user: auth.user, items, payments: [], error: '플랫폼 예약 상태를 확인하지 못했습니다.' }); return; }
      const ids = (reservations || []).map((row) => row.re_id);
      const paymentResult = ids.length ? await platformSupabase.from('reservation_payment').select('id,reservation_id,amount,payment_status,payment_method,created_at').in('reservation_id', ids) : { data: [], error: null };
      if (!cancelled) setState({ loading: false, user: auth.user, items, payments: paymentResult.data || [], error: paymentResult.error ? '결제 상태를 확인하지 못했습니다.' : '' });
    }
    void load(); return () => { cancelled = true; };
  }, []);
  const pendingPayments = state.payments.filter((payment) => payment.payment_status === 'pending' && Number(payment.amount) > 0);
  const pendingTotal = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cartTotal = bookingCartTotal(state.items);

  return <div className="booking-page"><div className="booking-shell checkout-shell">
    <Link href="/booking/cart" className="booking-back">← 장바구니</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">FINAL REVIEW</span><h1>통합 예약·결제</h1></div><span className="beta-badge">SECURE CHECKOUT</span></div>
    {state.loading ? <div className="booking-empty"><h2>플랫폼 상태를 확인하고 있습니다.</h2><p>홈페이지 장바구니와 예약 소유권, 결제 가능 금액을 조회합니다.</p></div> : <div className="checkout-grid">
      <section className="booking-panel"><div className="booking-panel-head"><h2>장바구니 {state.items.length}건</h2></div><div className="booking-panel-body"><ol className="checkout-items">{state.items.map((item) => <li key={item.id}><span>{item.serviceLabel}</span><strong>{item.name}</strong><small>{item.startDate || '일정 확인'} · {item.optionName || '옵션 확인'}</small></li>)}</ol><div className="checkout-reference"><span>등록 요금 참고 합계</span><strong>{cartTotal > 0 ? `${cartTotal.toLocaleString('ko-KR')} VND` : '견적 확인'}</strong></div></div></section>
      <aside className="booking-panel"><div className="booking-panel-head"><h2>결제 준비 상태</h2></div><div className="booking-panel-body"><dl className="checkout-steps"><div className="done"><dt>01</dt><dd><strong>고객 인증</strong><span>{state.user?.email}</span></dd></div><div className={state.items.length ? 'done' : ''}><dt>02</dt><dd><strong>여행 구성</strong><span>{state.items.length ? `${state.items.length}개 서비스 선택` : '장바구니를 구성해 주세요'}</span></dd></div><div className={pendingPayments.length ? 'done' : ''}><dt>03</dt><dd><strong>플랫폼 승인</strong><span>{pendingPayments.length ? `결제 대기 ${pendingPayments.length}건` : '매니저 확인 후 활성화'}</span></dd></div><div><dt>04</dt><dd><strong>OnePay 결제</strong><span>승인 금액 확정 후 진행</span></dd></div></dl>{state.error && <p className="booking-error">{state.error}</p>}{pendingPayments.length > 0 ? <><div className="checkout-payable"><span>플랫폼 결제 대기 합계</span><strong>{pendingTotal.toLocaleString('ko-KR')} VND</strong></div><div className="booking-warning">결제 레코드는 준비되었습니다. 고객용 OnePay 링크 발급 API는 소유권·통합결제 멱등 검증 후 활성화됩니다.</div></> : <div className="booking-warning">장바구니 상품을 기존 플랫폼에서 예약 완료하면 매니저가 확인하고 결제 금액을 확정합니다.</div>}<div className="booking-controls"><a href="https://customer.stayhalong.com/mypage/direct-booking" target="_blank" rel="noreferrer">플랫폼에서 예약 완료 ↗</a><a href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer" className="secondary">통합 결제 문의 ↗</a></div></div></aside>
    </div>}
  </div></div>;
}
