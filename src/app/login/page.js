import Link from 'next/link';
import './auth.css';

export default function Login() {
  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">로그인</h1>
        <p className="auth-subtitle">스테이하롱에 오신 것을 환영합니다.</p>
        
        <form className="auth-form">
          <div className="form-group">
            <label htmlFor="email">이메일</label>
            <input type="email" id="email" placeholder="이메일을 입력하세요" required />
          </div>
          <div className="form-group">
            <label htmlFor="password">비밀번호</label>
            <input type="password" id="password" placeholder="비밀번호를 입력하세요" required />
          </div>
          
          <div className="auth-options">
            <label className="checkbox-label">
              <input type="checkbox" /> 로그인 유지
            </label>
            <Link href="/forgot" className="forgot-link">비밀번호 찾기</Link>
          </div>
          
          <button type="submit" className="btn-primary auth-submit">로그인</button>
        </form>
        
        <div className="auth-footer">
          아직 회원이 아니신가요? <Link href="/register">회원가입</Link>
        </div>
      </div>
    </div>
  );
}
