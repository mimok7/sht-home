'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { addBookingCartItem } from '@/lib/booking-cart';
import '../../booking.css';

const SERVICES = {
  cruise_vehicle: { label: '크루즈 차량', example: '하노이 ↔ 하롱 전용 차량' },
  airport: { label: '공항 이동', example: '노이바이 공항 픽업' },
  rentcar: { label: '렌터카', example: '기사 포함 전용 차량' },
  tour: { label: '투어', example: '하롱베이 당일 투어' },
  package: { label: '패키지', example: '크루즈 + 호텔 패키지' },
  ticket: { label: '티켓', example: '공연 또는 입장권' },
};

export default function ServiceDraftPage({ params }) {
  const { type } = use(params);
  const service = SERVICES[type];
  const [form, setForm] = useState({ name: service?.example || '', date: '', adults: 2, children: 0, quantity: 1, note: '' });
  const [saved, setSaved] = useState(false);
  if (!service) return <div className="booking-page"><div className="booking-shell"><div className="booking-empty"><h1>서비스를 찾을 수 없습니다.</h1><Link href="/booking">예약 홈으로 →</Link></div></div></div>;

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); setSaved(false); }
  function add(event) {
    event.preventDefault();
    addBookingCartItem({
      id: `${type}:${form.date}:${form.name}`,
      serviceType: type, productId: `${type}-request`, name: form.name, optionName: '상세 조건 매니저 확인',
      startDate: form.date, adults: Number(form.adults), children: Number(form.children), infants: 0,
      quantity: Number(form.quantity), unitPrice: 0, currency: 'VND', priceStatus: 'reference',
      sourceHref: `/booking/service/${type}`, metadata: { requestNote: form.note },
    });
    setSaved(true);
  }

  return <div className="booking-page"><div className="booking-shell">
    <Link href="/booking" className="booking-back">← 전체 서비스</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">SERVICE REQUEST DRAFT</span><h1>{service.label}</h1></div><span className="beta-badge">CART READY</span></div>
    <section className="booking-panel"><div className="booking-panel-head"><h2>예약 요청 초안</h2></div><form className="booking-panel-body" onSubmit={add}>
      <div className="booking-fields">
        <div className="booking-field full"><label htmlFor="service-name">원하는 상품 또는 서비스</label><input id="service-name" value={form.name} onChange={(event) => update('name', event.target.value)} required /></div>
        <div className="booking-field"><label htmlFor="service-date">이용일</label><input id="service-date" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required /></div>
        <div className="booking-field"><label htmlFor="service-quantity">수량</label><input id="service-quantity" type="number" min="1" max="20" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} required /></div>
        <div className="booking-field"><label htmlFor="service-adults">성인</label><input id="service-adults" type="number" min="1" max="40" value={form.adults} onChange={(event) => update('adults', event.target.value)} required /></div>
        <div className="booking-field"><label htmlFor="service-children">아동</label><input id="service-children" type="number" min="0" max="40" value={form.children} onChange={(event) => update('children', event.target.value)} /></div>
        <div className="booking-field full"><label htmlFor="service-note">픽업 위치·항공편·요청사항</label><textarea id="service-note" value={form.note} onChange={(event) => update('note', event.target.value)} /></div>
      </div>
      <div className="booking-warning">현재 홈페이지에 공개 상품 카탈로그가 없는 서비스는 요청 초안으로 담습니다. 매니저가 기존 플랫폼에서 상품과 금액을 확인한 뒤 결제 금액이 확정됩니다.</div>
      {saved && <p className="booking-warning" role="status">장바구니에 담았습니다.</p>}
      <div className="booking-controls"><button type="submit">장바구니에 담기 ＋</button><Link href="/booking/cart" className="secondary">장바구니 보기 →</Link></div>
    </form></section>
  </div></div>;
}
