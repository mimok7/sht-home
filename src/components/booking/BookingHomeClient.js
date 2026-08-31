// 행복여행에 필요한 서비스를 홈페이지 장바구니에 담는 시작 화면이다.
'use client';

import Link from 'next/link';
import BookingCartLink from '@/components/BookingCartLink';

const SERVICES = [
  { key: 'cruise', name: '크루즈 예약', copy: '출항일, 일정, 크루즈와 객실 구성을 선택합니다.' },
  { key: 'cruise_vehicle', name: '크루즈 차량예약', copy: '크루즈 일정에 맞는 선착장 이동 차량을 선택합니다.' },
  { key: 'airport', name: '공항 서비스 예약', copy: '공항 픽업·샌딩의 경로와 차량, 항공편을 선택합니다.' },
  { key: 'hotel', name: '호텔 예약', copy: '체크인·체크아웃 날짜와 호텔 객실을 선택합니다.' },
  { key: 'rentcar', name: '렌터카 예약', copy: '이용 방식, 경로, 차량과 왕복 일정을 선택합니다.' },
  { key: 'tour', name: '투어 예약', copy: '투어, 인원 요금, 결제 방식과 픽업 장소를 선택합니다.' },
  { key: 'package', name: '패키지 예약', copy: '크루즈·공항·투어가 포함된 패키지와 인원 옵션을 선택합니다.' },
  { key: 'ticket', name: '티켓 예약', copy: '티켓 종류, 프로그램, 인원과 셔틀을 선택합니다.' },
];

export default function BookingHomeClient() {
  return <div className="booking-page">
    <section className="booking-hero"><div className="container"><span className="booking-kicker">HAPPY TRAVEL BOOKING</span><h1>행복 여행 예약</h1><p>원하는 여행 서비스를 한곳에 담아 나만의 행복여행을 준비해 보세요.</p><div className="booking-hero-actions"><BookingCartLink className="booking-action primary" showCount={false} header={false}>여행 장바구니 →</BookingCartLink><Link href="/booking/reservations" className="booking-action primary">내 예약 확인 →</Link></div></div></section>
    <section className="booking-section"><div className="container">
      <div className="booking-section-head"><div><span className="booking-section-kicker">01 / CHOOSE A SERVICE</span></div></div>
      <div className="service-grid">{SERVICES.map((service, index) => <article className="service-card" key={service.key}><span className="service-index">{String(index + 1).padStart(2, '0')} / SERVICE</span><h3>{service.name}</h3><p>{service.copy}</p><div className="service-actions"><Link href={service.key === 'cruise' ? '/cruises' : `/booking/service/${service.key}`} className="service-link">예약하기 →</Link></div></article>)}</div>
    </div></section>
  </div>;
}
