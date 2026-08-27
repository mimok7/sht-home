'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { bookingCartTotal, hydrateBookingCart, readBookingCart, removeBookingCartItem } from '@/lib/booking-cart';
import '../booking.css';

function money(value, currency) { return value > 0 ? `${value.toLocaleString('ko-KR')} ${currency}` : '견적 확인'; }
function editHref(item) { return `${item.sourceHref}${item.sourceHref.includes('?') ? '&' : '?'}editCartItem=${encodeURIComponent(item.id)}`; }

export default function BookingCartPage() {
  const [items, setItems] = useState([]);
  const [syncMessage, setSyncMessage] = useState('');
  useEffect(() => {
    queueMicrotask(() => {
      setItems(readBookingCart());
      void hydrateBookingCart().then((result) => {
        setItems(result.items);
        setSyncMessage(result.synced ? '로그인 계정의 홈페이지 장바구니에 저장되어 있습니다.' : (result.error || '로그인하면 홈페이지 장바구니에 저장됩니다.'));
      }).catch(() => setSyncMessage('장바구니 동기화 상태를 확인하지 못했습니다.'));
    });
  }, []);
  function remove(id) { setItems(removeBookingCartItem(id)); }
  const vndTotal = bookingCartTotal(items);
  const usdTotal = bookingCartTotal(items, 'USD');

  return <div className="booking-page"><div className="booking-shell cart-shell">
    <Link href="/booking" className="booking-back">← 서비스 더 담기</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">ONE JOURNEY / ONE CART</span><h1>여행 장바구니</h1></div><span className="beta-badge">{items.length} SERVICES</span></div>
    {syncMessage && <p className="booking-sync-note">{syncMessage}</p>}
    {items.length === 0 ? <div className="booking-empty"><h2>장바구니가 비어 있습니다.</h2><p>크루즈나 호텔 상품에서 일정과 옵션을 선택해 담아주세요.</p><Link className="booking-action primary" href="/cruises">크루즈 선택하기 →</Link></div> : <>
      <div className="cart-list">{items.map((item, index) => <article className="cart-item" key={item.id}>
        <div className="cart-number">{String(index + 1).padStart(2, '0')}</div>
        <div className="cart-copy"><span>{item.serviceLabel}</span><h2>{item.name}</h2><p>{[item.optionName, item.startDate, item.endDate && `~ ${item.endDate}`, `성인 ${item.adults}`, item.children ? `아동 ${item.children}` : '', item.infants ? `유아 ${item.infants}` : '', `수량 ${item.quantity}`].filter(Boolean).join(' · ')}</p><Link href={editHref(item)}>선택 수정 ↗</Link></div>
        <div className="cart-price"><small>{item.priceStatus === 'confirmed' ? '확정 금액' : '등록 요금 참고'}</small><strong>{money(item.unitPrice * item.quantity, item.currency)}</strong><button type="button" onClick={() => remove(item.id)}>삭제</button></div>
      </article>)}</div>
      <section className="cart-total"><div><span>REFERENCE TOTAL</span><p>할증·프로모션·재고 확인 전 참고 합계입니다.</p></div><div>{vndTotal > 0 && <strong>{money(vndTotal, 'VND')}</strong>}{usdTotal > 0 && <strong>{money(usdTotal, 'USD')}</strong>}</div></section>
      <div className="booking-warning">서로 다른 통화는 합산하지 않습니다. 최종 결제 금액은 모든 서비스가 플랫폼에서 승인되고 결제 레코드가 생성된 뒤 확정됩니다.</div>
      <div className="booking-controls"><Link href="/booking/checkout">전체 예약 확인 및 결제 준비 →</Link><Link href="/booking" className="secondary">서비스 더 담기</Link></div>
    </>}
  </div></div>;
}
