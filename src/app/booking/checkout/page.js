'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import { bookingCartTotal, getPlatformCartSession, hydrateBookingCart, readBookingCart, writeBookingCart } from '@/lib/booking-cart';
import '../booking.css';

export default function BookingCheckoutPage() {
  const [state, setState] = useState({ loading: true, user: null, items: [], payments: [], error: '', complete: null });
  const [submitting, setSubmitting] = useState(false);
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
      if (error) { setState({ loading: false, user: auth.user, items, payments: [], error: '플랫폼 예약 상태를 확인하지 못했습니다.', complete: null }); return; }
      const ids = (reservations || []).map((row) => row.re_id);
      const paymentResult = ids.length ? await platformSupabase.from('reservation_payment').select('id,reservation_id,amount,payment_status,payment_method,created_at').in('reservation_id', ids) : { data: [], error: null };
      if (!cancelled) setState({ loading: false, user: auth.user, items, payments: paymentResult.data || [], error: paymentResult.error ? '결제 상태를 확인하지 못했습니다.' : '', complete: null });
    }
    void load(); return () => { cancelled = true; };
  }, []);
  const pendingPayments = state.payments.filter((payment) => payment.payment_status === 'pending' && Number(payment.amount) > 0);
  const pendingTotal = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cartTotal = bookingCartTotal(state.items);
  const cartUsdTotal = bookingCartTotal(state.items, 'USD');
  const cartKrwTotal = bookingCartTotal(state.items, 'KRW');

  async function submitCart() {
    if (!state.items.length || submitting) return;
    setSubmitting(true);
    setState((current) => ({ ...current, error: '' }));
    try {
      const session = await getPlatformCartSession();
      if (!session) { window.location.replace(`/login?next=${encodeURIComponent('/booking/checkout')}`); return; }
      const response = await fetch('/api/booking/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '장바구니 예약을 저장하지 못했습니다.');
      writeBookingCart([]);
      setState((current) => ({ ...current, items: [], complete: result, error: '' }));
      const paymentResponse = await fetch('/api/payments/onepay/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ reservationIds: result.reservationIds, idempotencyKey: crypto.randomUUID() }) });
      const payment = await paymentResponse.json();
      if (!paymentResponse.ok || !payment.url) throw new Error(payment.error || '원페이 결제를 시작하지 못했습니다. 예약 내역에서 다시 시도해 주세요.');
      window.location.assign(payment.url);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || '장바구니 예약을 저장하지 못했습니다.' }));
    } finally { setSubmitting(false); }
  }

  return <div className="booking-page"><div className="booking-shell checkout-shell">
    <Link href="/booking/cart" className="booking-back">← 장바구니</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">FINAL REVIEW</span><h1>통합 예약·결제</h1></div><span className="beta-badge">SECURE CHECKOUT</span></div>
    {state.loading ? <div className="booking-empty"><h2>결제 정보를 확인하고 있습니다.</h2><p>홈페이지 장바구니와 예약 소유권, 결제 가능 금액을 조회합니다.</p></div> : state.complete ? <div className="booking-empty booking-submit-complete"><span className="booking-section-kicker">PAYMENT START</span><h2>{state.complete.itemCount}개 서비스를 저장했습니다.</h2><p>원페이 결제 페이지로 이동하지 못했습니다. 예약 내역에서 결제 상태를 확인해 주세요.</p>{state.error && <p className="booking-error">{state.error}</p>}<div className="booking-controls"><Link href="/booking/reservations">예약 내역 확인 →</Link><Link className="secondary" href="/booking">새 예약 시작</Link></div></div> : <div className="checkout-grid">
      <section className="booking-panel"><div className="booking-panel-head"><h2>장바구니 {state.items.length}건</h2></div><div className="booking-panel-body"><ol className="checkout-items">{state.items.map((item) => <li key={item.id}><span>{item.serviceLabel}</span><strong>{item.name}</strong><small>{item.startDate || '일정 확인'} · {item.optionName || '옵션 확인'}</small></li>)}</ol><div className="checkout-reference"><span>등록 요금 참고 합계</span><div className="checkout-reference-values">{cartTotal > 0 && <strong>{cartTotal.toLocaleString('ko-KR')} VND</strong>}{cartUsdTotal > 0 && <strong>{cartUsdTotal.toLocaleString('ko-KR')} USD</strong>}{cartKrwTotal > 0 && <strong>{cartKrwTotal.toLocaleString('ko-KR')} KRW</strong>}{cartTotal + cartUsdTotal + cartKrwTotal === 0 && <strong>견적 확인</strong>}</div></div></div></section>
      <aside className="booking-panel"><div className="booking-panel-head"><h2>원페이 결제</h2></div><div className="booking-panel-body">{state.error && <p className="booking-error">{state.error}</p>}{pendingPayments.length > 0 && <div className="checkout-payable"><span>기존 결제 대기 합계</span><strong>{pendingTotal.toLocaleString('ko-KR')} VND</strong></div>}<div className="booking-warning">결제 버튼을 누르면 최신 요금을 다시 확인해 예약을 생성하고, 원페이 결제 페이지로 이동합니다.</div><div className="booking-controls"><button type="button" disabled={!state.items.length || submitting} onClick={submitCart}>{submitting ? '결제 준비 중…' : '원페이 결제하기 →'}</button><a href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer" className="secondary">예약 문의 ↗</a></div></div></aside>
    </div>}
  </div></div>;
}
