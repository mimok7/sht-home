import Link from 'next/link';
import '../login/auth.css';

export default function Register() {
  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">회원가입</h1>
        <p className="auth-subtitle">스테이하롱의 회원이 되어 특별한 혜택을 누리세요.</p>
        
        <form className="auth-form">
          <div className="form-group">
            <label htmlFor="name">이름 (실명)</label>
            <input type="text" id="name" placeholder="홍길동" required />
          </div>
          <div className="form-group">
            <label htmlFor="email">이메일</label>
            <input type="email" id="email" placeholder="email@example.com" required />
          </div>
          <div className="form-group">
            <label htmlFor="password">비밀번호</label>
            <input type="password" id="password" placeholder="8자 이상 영문, 숫자, 특수문자 조합" required />
          </div>
          <div className="form-group">
            <label htmlFor="password-confirm">비밀번호 확인</label>
            <input type="password" id="password-confirm" placeholder="비밀번호를 다시 입력하세요" required />
          </div>
          <div className="form-group">
            <label htmlFor="phone">연락처</label>
            <input type="tel" id="phone" placeholder="010-1234-5678" required />
          </div>
          
          <button type="submit" className="btn-primary auth-submit">가입하기</button>
        </form>
        
        <div className="auth-footer">
          이미 계정이 있으신가요? <Link href="/login">로그인</Link>
        </div>
      </div>
    </div>
  );
}
