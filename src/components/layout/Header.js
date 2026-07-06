import Link from 'next/link';
import './Header.css';

export default function Header() {
  return (
    <header className="header glass">
      <div className="container header-content">
        <Link href="/" className="logo">
          STAY <span>HALONG</span>
        </Link>
        <nav className="nav-links">
          <Link href="/cruises" className="nav-link">크루즈 예약</Link>
          <Link href="/tours" className="nav-link">당일 투어</Link>
          <Link href="/transport" className="nav-link">차량 렌트</Link>
          <Link href="/community" className="nav-link">커뮤니티</Link>
        </nav>
        <div className="auth-buttons">
          <Link href="/login" className="btn-outline btn-sm">로그인</Link>
          <Link href="/register" className="btn-primary btn-sm">회원가입</Link>
        </div>
      </div>
    </header>
  );
}
