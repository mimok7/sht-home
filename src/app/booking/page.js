import Link from 'next/link';
import BookingCartLink from '@/components/BookingCartLink';
import './booking.css';

export const metadata = { title: '예약 | STAY HALONG' };

const services = [
  { key: 'cruise', name: '크루즈', copy: '객실과 일정을 고르고 여행 장바구니에 담습니다.', href: '/cruises' },
  { key: 'cruise_vehicle', name: '크루즈 차량', copy: '승선 전후 이동 차량을 크루즈 일정과 함께 준비합니다.', href: '/booking/service/cruise_vehicle' },
  { key: 'airport', name: '공항 이동', copy: '공항, 항공편, 경유지와 인원을 기준으로 차량을 예약합니다.', href: '/booking/service/airport' },
  { key: 'hotel', name: '호텔', copy: '숙박일, 객실 수, 인원과 조식 조건을 선택합니다.', href: '/hotels' },
  { key: 'rentcar', name: '렌터카', copy: '픽업·도착 위치와 탑승 인원을 기준으로 차량을 선택합니다.', href: '/booking/service/rentcar' },
  { key: 'tour', name: '투어', copy: '이용일, 픽업 위치와 참가 인원을 기준으로 투어를 예약합니다.', href: '/booking/service/tour' },
  { key: 'package', name: '패키지', copy: '여러 서비스를 하나의 일정과 견적으로 묶어 준비합니다.', href: '/booking/service/package' },
  { key: 'ticket', name: '티켓', copy: '공연과 입장권의 이용일 및 인원을 선택합니다.', href: '/booking/service/ticket' },
];

export default function BookingHome() {
  return <div className="booking-page">
    <section className="booking-hero">
      <div className="container">
        <span className="booking-kicker">CUSTOMER BOOKING</span>
        <h1>예약</h1>
        <p>여행에 필요한 서비스를 선택하고, 나만의 하롱베이 여행을 준비해 보세요.</p>
        <div className="booking-hero-actions">
          <BookingCartLink className="booking-action primary" showCount={false} header={false}>여행 장바구니 →</BookingCartLink>
          <Link href="/booking/reservations" className="booking-action primary">내 예약 확인 →</Link>
        </div>
      </div>
    </section>
    <section className="booking-section">
      <div className="container">
        <div className="booking-section-head">
          <div><span className="booking-section-kicker">01 / CHOOSE A SERVICE</span><h2>여행에 필요한<br />모든 예약.</h2></div>
          <p>여행 일정에 맞는 서비스를 선택해 예약을 시작하세요.</p>
        </div>
        <div className="service-grid">
          {services.map((service, index) => <article className="service-card" key={service.key}>
            <span className="service-index">{String(index + 1).padStart(2, '0')} / SERVICE</span>
            <h3>{service.name}</h3>
            <p>{service.copy}</p>
            <span className="service-status">예약</span>
            <div className="service-actions">
              <Link href={service.href} className="service-link">예약하기 →</Link>
            </div>
          </article>)}
        </div>
      </div>
    </section>
  </div>;
}
