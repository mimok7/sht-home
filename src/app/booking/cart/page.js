'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import { bookingCartTotal, getPlatformCartSession, hydrateBookingCart, readBookingCart, removeBookingCartItem, syncBookingCart } from '@/lib/booking-cart';
import '../booking.css';

function money(value, currency) { return value > 0 ? `${value.toLocaleString('ko-KR')} ${currency}` : '견적 확인'; }
function editHref(item) { return `${item.sourceHref}${item.sourceHref.includes('?') ? '&' : '?'}editCartItem=${encodeURIComponent(item.id)}`; }
function cartPriceFormula(item) {
  const total = item.unitPrice * item.quantity;
  const passengers = Number(item.adults || 0) + Number(item.children || 0) + Number(item.infants || 0);
  const isCruiseShuttle = item.serviceType === 'cruise_vehicle' && item.metadata?.platform?.vehicleServiceType === 'cruise_shuttle';
  const quantity = item.serviceType === 'cruise' ? Math.max(1, passengers) : isCruiseShuttle ? Math.max(1, Number(item.metadata?.platform?.passengerCount || item.quantity || 1)) : Math.max(1, Number(item.quantity || 1));
  const unitPrice = total / quantity;
  return `단가 ${money(unitPrice, item.currency)} × ${quantity}${item.serviceType === 'cruise' || isCruiseShuttle ? '명' : '개'}`;
}

function quoteDate(value = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(value);
}

function quoteNumber(value = new Date()) {
  return `SHT-Q-${value.toISOString().slice(0, 10).replaceAll('-', '')}`;
}

function quoteItemDetails(item) {
  return [item.optionName, item.startDate, item.endDate && `~ ${item.endDate}`, item.adults ? `성인 ${item.adults}` : '', item.children ? `아동 ${item.children}` : '', item.infants ? `유아 ${item.infants}` : '', `수량 ${item.quantity}`].filter(Boolean).join(' · ');
}

function quoteItemName(item) {
  return item.serviceType === 'airport' && item.metadata?.airportRoute ? item.metadata.airportRoute : item.name;
}

function recipientLabel(value) {
  const name = String(value || '').trim();
  return name ? (name.endsWith('고객님') ? name : `${name} 고객님`) : '고객님';
}

function QuoteTotals({ vndTotal, usdTotal, krwTotal }) {
  const totals = [['VND', vndTotal], ['USD', usdTotal], ['KRW', krwTotal]].filter(([, total]) => total > 0);
  return <div className="cart-quote-totals"><span>ESTIMATED TOTAL</span><div>{totals.length ? totals.map(([currency, total]) => <strong key={currency}>{money(total, currency)}</strong>) : <strong>견적 확인</strong>}</div></div>;
}

export default function BookingCartPage() {
  const [authorized, setAuthorized] = useState(false);
  const [items, setItems] = useState([]);
  const [syncMessage, setSyncMessage] = useState('');
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteRecipient, setQuoteRecipient] = useState('');
  const [quoteMemo, setQuoteMemo] = useState('');
  const [quoteCreatedAt, setQuoteCreatedAt] = useState(() => new Date());
  const [savedQuoteNumber, setSavedQuoteNumber] = useState('');
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quotePrinting, setQuotePrinting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const redirectToLogin = () => {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
    };
    const refresh = () => {
      void hydrateBookingCart().then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setSyncMessage(result.synced ? '로그인 계정의 홈페이지 장바구니에 저장되어 있습니다.' : (result.error || '장바구니 동기화 상태를 확인하지 못했습니다.'));
      }).catch(() => {
        if (!cancelled) setSyncMessage('장바구니 동기화 상태를 확인하지 못했습니다.');
      });
    };
    const updateFromLocalCart = () => setItems(readBookingCart());
    async function load() {
      const session = await getPlatformCartSession();
      if (cancelled) return;
      if (!session) {
        redirectToLogin();
        return;
      }
      setAuthorized(true);
      setQuoteRecipient(session.user.user_metadata?.name || session.user.user_metadata?.full_name || '');
      updateFromLocalCart();
      refresh();
    }
    void load();
    const { data: listener } = platformSupabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthorized(false);
        setItems([]);
        redirectToLogin();
      }
    });
    window.addEventListener('storage', updateFromLocalCart);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
      window.removeEventListener('storage', updateFromLocalCart);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  function remove(id) { setItems(removeBookingCartItem(id)); }
  const vndTotal = bookingCartTotal(items);
  const usdTotal = bookingCartTotal(items, 'USD');
  const krwTotal = bookingCartTotal(items, 'KRW');
  const printQuote = () => {
    if (quotePrinting) return;
    const quote = document.querySelector('[data-quote-document]');
    if (!quote) return;

    setQuotePrinting(true);
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden;';
    const copiedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((style) => style.outerHTML).join('');
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      printFrame.remove();
      setQuotePrinting(false);
    };
    printFrame.onload = () => {
      const printWindow = printFrame.contentWindow;
      if (!printWindow) return cleanup();
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      window.setTimeout(cleanup, 60000);
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 100);
    };
    printFrame.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>스테이하롱 여행 견적서</title>${copiedStyles}<style>@media print{@page{size:A4;margin:12mm}html,body{margin:0!important;background:#fff!important}.cart-quote{position:static!important;width:100%!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box}.cart-quote-row,.cart-quote-totals{break-inside:avoid}.no-print{display:none!important}}</style></head><body>${quote.outerHTML}</body></html>`;
    document.body.appendChild(printFrame);
  };
  const openQuoteModal = () => {
    setSavedQuoteNumber('');
    setQuoteCreatedAt(new Date());
    setQuoteModalOpen(true);
  };
  const saveQuote = async () => {
    setQuoteSaving(true);
    try {
      const session = await getPlatformCartSession();
      if (!session) throw new Error('로그인 정보를 확인하지 못했습니다.');
      await syncBookingCart(items);
      const response = await fetch('/api/booking/cart-quote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ recipientName: recipientLabel(quoteRecipient), memo: quoteMemo }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '견적서를 저장하지 못했습니다.');
      setSavedQuoteNumber(result.quoteNumber);
      setQuoteCreatedAt(new Date(result.issuedAt));
    } catch (error) {
      alert(error instanceof Error ? error.message : '견적서를 저장하지 못했습니다.');
    } finally {
      setQuoteSaving(false);
    }
  };

  if (!authorized) return null;
  return <div className="booking-page"><div className="booking-shell cart-shell">
    <Link href="/booking" className="booking-back">← 서비스 더 담기</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">ONE JOURNEY / ONE CART</span><h1>여행 장바구니</h1></div><span className="beta-badge">{items.length} SERVICES</span></div>
    {syncMessage && <p className="booking-sync-note">{syncMessage}</p>}
    {items.length === 0 ? <div className="booking-empty"><h2>장바구니가 비어 있습니다.</h2><p>크루즈나 호텔 상품에서 일정과 옵션을 선택해 담아주세요.</p><Link className="booking-action primary" href="/cruises">크루즈 선택하기 →</Link></div> : <>
      <div className="cart-list">{items.map((item, index) => <article className="cart-item" key={item.id}>
        <div className="cart-number">{String(index + 1).padStart(2, '0')}</div>
        <div className="cart-copy"><span>{item.serviceLabel}</span><h2>{quoteItemName(item)}</h2><p>{[item.optionName, item.startDate, item.endDate && `~ ${item.endDate}`, `성인 ${item.adults}`, item.children ? `아동 ${item.children}` : '', item.infants ? `유아 ${item.infants}` : '', `수량 ${item.quantity}`].filter(Boolean).join(' · ')}</p><Link href={editHref(item)}>선택 수정 ↗</Link></div>
        <div className="cart-price"><small>{cartPriceFormula(item)}</small><strong>{money(item.unitPrice * item.quantity, item.currency)}</strong><button type="button" onClick={() => remove(item.id)}>삭제</button></div>
      </article>)}</div>
      <section className="cart-total"><div><span>ESTIMATED TOTAL</span><p>할증·프로모션·재고 확인 전 참고 합계입니다.</p></div><div>{vndTotal > 0 && <strong>{money(vndTotal, 'VND')}</strong>}{usdTotal > 0 && <strong>{money(usdTotal, 'USD')}</strong>}{krwTotal > 0 && <strong>{money(krwTotal, 'KRW')}</strong>}</div></section>
      <div className="booking-warning">최종 결제 금액은 결제 단계에서 최신 요금과 예약 가능 여부를 다시 확인합니다.</div>
      <section className="cart-quote-trigger no-print" aria-label="견적서 도구"><div><span>QUOTATION</span><strong>장바구니 견적서</strong><small>필요할 때 열어 발행한 뒤 PDF로 저장하거나 인쇄할 수 있습니다.</small></div><button type="button" aria-haspopup="dialog" onClick={openQuoteModal}>견적서 열기</button></section>
      {quoteModalOpen && <div className="cart-quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-editor-title"><div className="cart-quote-modal-panel"><div className="cart-quote-modal-heading no-print"><div><span>QUOTATION / CART ITEMS</span><h2>장바구니 견적서</h2></div><button type="button" onClick={() => setQuoteModalOpen(false)} aria-label="견적서 팝업 닫기">닫기 ×</button></div><section className="cart-quote-editor no-print" aria-labelledby="quote-editor-title"><div><span className="booking-section-kicker">QUOTATION / CART ITEMS</span><h2 id="quote-editor-title">견적서 발행</h2><p>장바구니 상품과 현재 선택 금액으로 견적서를 발행합니다.</p></div><div className="cart-quote-fields"><label>견적 받는 분<input value={quoteRecipient} onChange={(event) => { setQuoteRecipient(event.target.value); setSavedQuoteNumber(''); }} placeholder="성함 또는 회사명" /></label><label>메모<input value={quoteMemo} onChange={(event) => { setQuoteMemo(event.target.value); setSavedQuoteNumber(''); }} placeholder="선택 사항" /></label></div><div className="cart-quote-actions"><button type="button" onClick={saveQuote} disabled={quoteSaving}>{quoteSaving ? '발행 중…' : '견적서 발행'}</button><button type="button" className="secondary" onClick={printQuote} disabled={!savedQuoteNumber || quoteSaving || quotePrinting}>{quotePrinting ? '인쇄 준비 중…' : '견적서 인쇄'}</button><button type="button" className="secondary" onClick={printQuote} disabled={!savedQuoteNumber || quoteSaving || quotePrinting}>{quotePrinting ? 'PDF 준비 중…' : 'PDF로 저장'}</button></div><p className="cart-quote-help">견적서 발행 후 인쇄하거나 PDF로 저장할 수 있습니다.</p></section>
      <article className="cart-quote" data-quote-document aria-label="장바구니 여행 견적서"><header className="cart-quote-header"><div><span>STAY HALONG</span><h2>여행 견적서</h2><p>TRAVEL QUOTATION</p></div><dl><div><dt>견적 번호</dt><dd>{savedQuoteNumber || quoteNumber(quoteCreatedAt)}</dd></div><div><dt>발행일</dt><dd>{quoteDate(quoteCreatedAt)}</dd></div></dl></header><section className="cart-quote-recipient"><div><span>TO</span><strong>{recipientLabel(quoteRecipient)}</strong></div><div><span>여행 상품</span><strong>{items.length}개 서비스</strong></div></section><p className="cart-quote-intro">아래 내용은 요청하신 여행 상품의 참고 견적입니다. 이용일과 예약 가능 여부를 확인한 뒤 최종 예약 금액이 확정됩니다.</p><section className="cart-quote-services"><div className="cart-quote-table-head"><span>NO.</span><span>상품 및 이용 정보</span><span>참고 금액</span></div>{items.map((item, index) => <div className="cart-quote-row" key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><small>{item.serviceLabel}</small><strong>{quoteItemName(item)}</strong><p>{quoteItemDetails(item)}</p><em>{cartPriceFormula(item)}</em></div><b>{money(item.unitPrice * item.quantity, item.currency)}</b></div>)}</section><QuoteTotals vndTotal={vndTotal} usdTotal={usdTotal} krwTotal={krwTotal} />{quoteMemo && <section className="cart-quote-memo"><span>MEMO</span><p>{quoteMemo}</p></section>}<footer className="cart-quote-footer"><div><strong>STAY HALONG</strong><span>하롱베이 현지 프리미엄 여행</span></div><p>본 견적서는 예약 확정서가 아닙니다.<br />최종 금액과 예약 가능 여부는 결제 전 다시 확인합니다.<br />견적서의 유효기간은 발생일로 부터 2일간 입니다.</p></footer></article></div></div>}
      <div className="booking-controls"><Link href="/booking/checkout">원페이 결제하기 →</Link><Link href="/booking" className="secondary">서비스 더 담기</Link></div>
    </>}
  </div></div>;
}
