'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import './auth.css';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const { data: authData, error: signInError } = await platformSupabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError('이메일 또는 비밀번호를 확인해 주세요.');
      return;
    }
    const { data: profile } = await platformSupabase.from('users').select('role').eq('id', authData.user.id).maybeSingle();
    const role = profile?.role || authData.user.app_metadata?.role || '';
    const isOperator = role === 'admin' || role === 'manager';
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(isOperator ? '/admin' : (next?.startsWith('/') ? next : '/'));
    router.refresh();
  }

  return <div className="auth-container"><div className="auth-card"><h1 className="auth-title">로그인</h1><p className="auth-subtitle">스테이하롱에 오신 것을 환영합니다.</p><form className="auth-form" onSubmit={handleSubmit}><div className="form-group"><label htmlFor="email">이메일</label><input type="email" id="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="이메일을 입력하세요" required /></div><div className="form-group"><label htmlFor="password">비밀번호</label><input type="password" id="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호를 입력하세요" required /></div><div className="auth-options"><label className="checkbox-label"><input type="checkbox" /> 로그인 유지</label><Link href="/forgot" className="forgot-link">비밀번호 찾기</Link></div>{error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="btn-primary auth-submit" disabled={submitting}>{submitting ? '로그인 중...' : '로그인'}</button></form><div className="auth-footer">아직 회원이 아니신가요? <Link href="/register">회원가입</Link></div></div></div>;
}
