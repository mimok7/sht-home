'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../login/auth.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const { data: listener } = platformSupabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function requestReset(event) {
    event.preventDefault();
    setSubmitting(true); setError(''); setMessage('');
    const { error: resetError } = await platformSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/forgot`,
    });
    if (resetError) setError(resetError.message);
    else setMessage('비밀번호 재설정 링크를 이메일로 보냈습니다. 메일의 링크를 열어 새 비밀번호를 설정해 주세요.');
    setSubmitting(false);
  }

  async function updatePassword(event) {
    event.preventDefault();
    setSubmitting(true); setError(''); setMessage('');
    const { error: updateError } = await platformSupabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else setMessage('새 비밀번호를 저장했습니다. 이제 로그인할 수 있습니다.');
    setSubmitting(false);
  }

  return <div className="auth-container"><div className="auth-card">
    <h1 className="auth-title">{recovery ? '새 비밀번호' : '비밀번호 찾기'}</h1>
    <p className="auth-subtitle">{recovery ? '새 비밀번호를 입력해 주세요.' : '가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.'}</p>
    <form className="auth-form" onSubmit={recovery ? updatePassword : requestReset}>
      {!recovery && <div className="form-group"><label htmlFor="email">이메일</label><input type="email" id="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일을 입력하세요" required /></div>}
      {recovery && <div className="form-group"><label htmlFor="password">새 비밀번호</label><input type="password" id="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" placeholder="6자 이상 입력하세요" required /></div>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-success" role="status">{message}</p>}
      <button type="submit" className="btn-primary auth-submit" disabled={submitting}>{submitting ? '처리 중…' : recovery ? '새 비밀번호 저장' : '재설정 링크 보내기'}</button>
    </form>
    <div className="auth-footer"><Link href="/login">로그인으로 돌아가기</Link></div>
  </div></div>;
}
