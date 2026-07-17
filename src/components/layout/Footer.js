 'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './Footer.css';

export default function Footer() {
  const temporary = usePathname() === '/temp-home';
  const item = (href, label) => temporary ? <span className="footer-disabled">{label}</span> : <Link href={href}>{label}</Link>;
  const upcomingItem = (label) => <span className="footer-disabled" aria-label={`${label} 서비스 준비 중`}>{label} <small>준비 중</small></span>;
  const externalItem = (href, label) => temporary ? <span className="footer-disabled">{label}</span> : <a href={href} target="_blank" rel="noreferrer">{label}</a>;
  return (
    <footer className="footer">
      <div className="container footer-content">
        <div className="footer-brand">
          <h3>STAY <span>HALONG</span></h3>
          <p>베트남 하롱베이 현지 프리미엄 여행사</p>
          <p>가장 아름다운 하롱베이의 순간을 선사합니다.</p>
        </div>
        
        <div className="footer-links">
          <div className="link-group">
            <h4>서비스</h4>
            {item('/cruises', '하롱베이 크루즈')}
            {upcomingItem('당일 투어')}
            {upcomingItem('차량/렌트카')}
            {upcomingItem('호텔 예약')}
          </div>
          
          <div className="link-group">
            <h4>고객센터</h4>
            {item('/travel-guide', '하롱 여행 안내')}
            {item('/notice', '공지사항')}
            {item('/faq', '자주 묻는 질문')}
            {externalItem('http://pf.kakao.com/_zvsxaG/chat', '1:1 문의 (카톡)')}
          </div>
          
          <div className="link-group contact-info">
            <h4>Contact Us</h4>
            <p><strong>카카오톡:</strong> 스테이하롱</p>
            <p><strong>영업시간:</strong> 09:00 - 23:00</p>
          </div>
        </div>
      </div>
      
      <div className="footer-bottom">
        <div className="container">
          <p>&copy; {new Date().getFullYear()} STAY HALONG. All rights reserved.</p>
          <div className="legal-links">
            {item('/terms', '이용약관')}
            {item('/privacy', '개인정보처리방침')}
          </div>
        </div>
      </div>
    </footer>
  );
}
