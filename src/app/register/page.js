'use client';

import Link from 'next/link';
import { useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../login/auth.css';

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', phone: '' });
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function change(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (form.password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (form.password !== form.confirm) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
    setSubmitting(true);
    const { data, error: signUpError } = await platformSupabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.name.trim(), phone: form.phone.trim() } },
    });
    setSubmitting(false);
    if (signUpError) { setError(signUpError.message.includes('already') ? '이미 가입된 이메일입니다.' : '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    if (data.session) window.location.assign('/');
    else setComplete(true);
  }

  if (complete) return <div className="auth-container"><div className="auth-card"><h1 className="auth-title">확인 필요</h1><p className="auth-subtitle">입력하신 이메일로 인증 링크를 보냈습니다. 이메일 인증을 완료하면 로그인할 수 있습니다.</p><div className="auth-footer"><Link href="/login">로그인으로 이동</Link></div></div></div>;

  return <div className="auth-container"><div className="auth-card"><h1 className="auth-title">회원가입</h1><p className="auth-subtitle">스테이하롱의 회원이 되어 특별한 혜택을 누리세요.</p><form className="auth-form" onSubmit={handleSubmit}><div className="form-group"><label htmlFor="name">이름 (실명)</label><input name="name" type="text" id="name" value={form.name} onChange={change} placeholder="홍길동" required /></div><div className="form-group"><label htmlFor="email">이메일</label><input name="email" type="email" id="email" value={form.email} onChange={change} placeholder="email@example.com" required /></div><div className="form-group"><label htmlFor="password">비밀번호</label><input name="password" type="password" id="password" value={form.password} onChange={change} placeholder="8자 이상" required /></div><div className="form-group"><label htmlFor="password-confirm">비밀번호 확인</label><input name="confirm" type="password" id="password-confirm" value={form.confirm} onChange={change} placeholder="비밀번호를 다시 입력하세요" required /></div><div className="form-group"><label htmlFor="phone">연락처</label><input name="phone" type="tel" id="phone" value={form.phone} onChange={change} placeholder="010-1234-5678" required /></div>{error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="btn-primary auth-submit" disabled={submitting}>{submitting ? '가입 처리 중...' : '가입하기'}</button></form><div className="auth-footer">이미 계정이 있으신가요? <Link href="/login">로그인</Link></div></div></div>;
}
