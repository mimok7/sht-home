import Link from 'next/link';
import './booking.css';

export const metadata = { title: '새 예약 베타 | STAY HALONG' };

const PLATFORM = 'https://customer.stayhalong.com';
const services = [
  { key: 'cruise', name: '크루즈', copy: '홈페이지 상품에서 객실과 일정을 고르고 예약 초안을 이어갑니다.', href: '/cruises', ready: true },
  { key: 'cruise/vehicle', name: '크루즈 차량', copy: '승선 전후 이동 차량을 크루즈 일정과 함께 준비합니다.' },
  { key: 'airport', name: '공항 이동', copy: '공항, 항공편, 경유지와 인원을 기준으로 차량을 예약합니다.' },
  { key: 'hotel', name: '호텔', copy: '숙박일, 객실 수, 인원과 조식 조건을 접수합니다.', href: '/hotels' },
  { key: 'rentcar', name: '렌터카', copy: '픽업·도착 위치와 탑승 인원을 기준으로 차량을 선택합니다.' },
  { key: 'tour', name: '투어', copy: '이용일, 픽업 위치와 참가 인원을 기준으로 투어를 예약합니다.' },
  { key: 'package', name: '패키지', copy: '여러 서비스를 하나의 일정과 견적으로 묶어 준비합니다.' },
  { key: 'ticket', name: '티켓', copy: '공연과 입장권의 이용일 및 인원을 선택합니다.' },
];

export default function BookingHome() {
  return <div className="booking-page">
    <section className="booking-hero">
      <div className="container">
        <span className="booking-kicker">CUSTOMER BOOKING · PARALLEL BETA</span>
        <h1>예약은 새롭게.<br /><span>운영은 그대로.</span></h1>
        <p>홈페이지 고객 예약 화면을 단계적으로 옮기고 있습니다. 기존 플랫폼과 같은 계정·예약 데이터를 사용하며, 매니저 업무와 기존 예약 기능은 변경하지 않습니다.</p>
        <div className="booking-hero-actions">
          <Link href="/booking/reservations" className="booking-action primary">내 예약 확인 →</Link>
          <a href={PLATFORM} target="_blank" rel="noreferrer" className="booking-action">기존 예약 플랫폼 ↗</a>
        </div>
      </div>
    </section>
    <section className="booking-section">
      <div className="container">
        <div className="booking-section-head">
          <div><span className="booking-section-kicker">01 / CHOOSE A SERVICE</span><h2>여행에 필요한<br />모든 예약.</h2></div>
          <p>크루즈를 첫 수직 흐름으로 구현하고 있으며, 나머지 서비스는 기존 플랫폼을 유지한 채 하나씩 홈페이지 디자인으로 이전합니다.</p>
        </div>
        <div className="service-grid">
          {services.map((service, index) => <article className="service-card" key={service.key}>
            <span className="service-index">{String(index + 1).padStart(2, '0')} / SERVICE</span>
            <h3>{service.name}</h3>
            <p>{service.copy}</p>
            <span className={`service-status ${service.ready ? 'ready' : ''}`}>{service.ready ? '홈페이지 베타 연결' : '홈페이지 이관 중'}</span>
            <div className="service-actions">
              {service.href && <Link href={service.href} className="service-link">홈페이지에서 보기 →</Link>}
              <a href={`${PLATFORM}/mypage/direct-booking/${service.key}`} target="_blank" rel="noreferrer" className="service-link legacy">기존 플랫폼 ↗</a>
            </div>
          </article>)}
        </div>
        <div className="parallel-note"><strong>PARALLEL RULE</strong><p>홈페이지 예약이 완성되고 검수 승인을 받기 전까지 기존 플랫폼 링크와 기능은 제거하거나 변경하지 않습니다.</p></div>
      </div>
    </section>
  </div>;
}
