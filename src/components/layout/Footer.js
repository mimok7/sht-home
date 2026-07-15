import Link from 'next/link';
import './Footer.css';

export default function Footer() {
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
            <Link href="/cruises">하롱베이 크루즈</Link>
            <Link href="/tours">당일 투어</Link>
            <Link href="/transport">차량/렌트카</Link>
            <Link href="/hotels">호텔 예약</Link>
          </div>
          
          <div className="link-group">
            <h4>고객센터</h4>
            <Link href="/notice">공지사항</Link>
            <Link href="/faq">자주 묻는 질문</Link>
            <a href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">1:1 문의 (카톡)</a>
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
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
