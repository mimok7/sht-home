'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import { bookingCartTotal, getPlatformCartSession, hydrateBookingCart, readBookingCart, writeBookingCart } from '@/lib/booking-cart';
import '../booking.css';

export default function BookingCheckoutPage() {
  const [state, setState] = useState({ loading: true, user: null, items: [], payments: [], quotes: [], activeQuoteId: '', error: '', complete: null });
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
      const [{ data: reservations, error }, quotesResult] = await Promise.all([
        platformSupabase.from('reservation').select('re_id,re_type,re_status,total_amount,payment_status,re_quote_id').eq('re_user_id', auth.user.id).order('re_created_at', { ascending: false }),
        platformSupabase.from('quote').select('id,title,status,created_at').eq('user_id', auth.user.id).in('status', ['draft', 'approved']).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      if (error || quotesResult.error) { setState({ loading: false, user: auth.user, items, payments: [], quotes: [], activeQuoteId: '', error: '플랫폼 예약 상태를 확인하지 못했습니다.', complete: null }); return; }
      const ids = (reservations || []).map((row) => row.re_id);
      const paymentResult = ids.length ? await platformSupabase.from('reservation_payment').select('id,reservation_id,amount,payment_status,payment_method,created_at').in('reservation_id', ids) : { data: [], error: null };
      const quotes = [...(quotesResult.data || [])].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
      if (!cancelled) setState({ loading: false, user: auth.user, items, payments: paymentResult.data || [], quotes, activeQuoteId: quotes[0]?.id || '', error: paymentResult.error ? '결제 상태를 확인하지 못했습니다.' : '', complete: null });
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
      const response = await fetch('/api/booking/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ quoteId: state.activeQuoteId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '장바구니 예약을 저장하지 못했습니다.');
      writeBookingCart([]);
      setState((current) => ({ ...current, items: [], complete: result, error: '' }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || '장바구니 예약을 저장하지 못했습니다.' }));
    } finally { setSubmitting(false); }
  }

  return <div className="booking-page"><div className="booking-shell checkout-shell">
    <Link href="/booking/cart" className="booking-back">← 장바구니</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">FINAL REVIEW</span><h1>통합 예약·결제</h1></div><span className="beta-badge">SECURE CHECKOUT</span></div>
    {state.loading ? <div className="booking-empty"><h2>플랫폼 상태를 확인하고 있습니다.</h2><p>홈페이지 장바구니와 예약 소유권, 결제 가능 금액을 조회합니다.</p></div> : state.complete ? <div className="booking-empty booking-submit-complete"><span className="booking-section-kicker">PLATFORM SAVE COMPLETE</span><h2>{state.complete.itemCount}개 서비스를 저장했습니다.</h2><p>홈페이지 DB 장바구니는 비웠고, 고객앱과 같은 플랫폼 예약 및 서비스 상세 데이터가 생성되었습니다.</p><div className="booking-controls"><Link href="/booking/reservations">저장된 예약 확인 →</Link><Link className="secondary" href="/booking">새 예약 시작</Link></div></div> : <div className="checkout-grid">
      <section className="booking-panel"><div className="booking-panel-head"><h2>장바구니 {state.items.length}건</h2></div><div className="booking-panel-body"><ol className="checkout-items">{state.items.map((item) => <li key={item.id}><span>{item.serviceLabel}</span><strong>{item.name}</strong><small>{item.startDate || '일정 확인'} · {item.optionName || '옵션 확인'}</small></li>)}</ol><div className="checkout-reference"><span>등록 요금 참고 합계</span><div className="checkout-reference-values">{cartTotal > 0 && <strong>{cartTotal.toLocaleString('ko-KR')} VND</strong>}{cartUsdTotal > 0 && <strong>{cartUsdTotal.toLocaleString('ko-KR')} USD</strong>}{cartKrwTotal > 0 && <strong>{cartKrwTotal.toLocaleString('ko-KR')} KRW</strong>}{cartTotal + cartUsdTotal + cartKrwTotal === 0 && <strong>견적 확인</strong>}</div></div></div></section>
      <aside className="booking-panel"><div className="booking-panel-head"><h2>플랫폼 저장 준비</h2></div><div className="booking-panel-body"><dl className="checkout-steps"><div className="done"><dt>01</dt><dd><strong>고객 인증</strong><span>{state.user?.email}</span></dd></div><div className={state.items.length ? 'done' : ''}><dt>02</dt><dd><strong>홈페이지 DB 장바구니</strong><span>{state.items.length ? `${state.items.length}개 서비스 저장됨` : '장바구니를 구성해 주세요'}</span></dd></div><div><dt>03</dt><dd><strong>플랫폼 예약 저장</strong><span>최신 목록·요금 재검증 후 고객앱 구조로 생성</span></dd></div><div><dt>04</dt><dd><strong>매니저 승인·OnePay</strong><span>승인 금액 확정 후 기존 결제 흐름 진행</span></dd></div></dl>{state.quotes.length > 0 && <div className="booking-field checkout-quote-select"><label htmlFor="checkout-quote">연결할 견적</label><select id="checkout-quote" value={state.activeQuoteId} onChange={(event) => setState((current) => ({ ...current, activeQuoteId: event.target.value }))}>{state.quotes.map((quote) => <option value={quote.id} key={quote.id}>{quote.title} · {quote.status === 'approved' ? '승인' : '작성 중'}</option>)}</select></div>}{state.error && <p className="booking-error">{state.error}</p>}{pendingPayments.length > 0 && <div className="checkout-payable"><span>기존 결제 대기 합계</span><strong>{pendingTotal.toLocaleString('ko-KR')} VND</strong></div>}<div className="booking-warning">저장 버튼을 누르면 홈페이지 DB 장바구니를 플랫폼 DB의 견적·예약·서비스 상세 데이터로 변환합니다. 성공한 뒤 장바구니는 비워집니다.</div><div className="booking-controls"><button type="button" disabled={!state.items.length || submitting} onClick={submitCart}>{submitting ? '플랫폼 저장 중…' : '장바구니 예약 저장 →'}</button><a href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer" className="secondary">예약 문의 ↗</a></div></div></aside>
    </div>}
  </div></div>;
}
