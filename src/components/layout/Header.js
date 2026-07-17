'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import './Header.css';

const NAV_ITEMS = [
  { href: '/', label: '홈' },
  { href: '/cruises', label: '크루즈' },
  { href: '/travel-guide', label: '여행 가이드' },
  { href: '/faq', label: '고객센터' },
];

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [profileName, setProfileName] = useState('');
  const temporary = pathname === '/temp-home';

  useEffect(() => { queueMicrotask(() => setMenuOpen(false)); }, [pathname]);

  useEffect(() => {
    let mounted = true;
    async function loadIdentity(session) {
      const nextUser = session?.user || null;
      if (!mounted) return;
      setUser(nextUser);
      if (!nextUser) { setProfileName(''); return; }
      const { data } = await platformSupabase.from('users').select('name').eq('id', nextUser.id).maybeSingle();
      if (mounted) setProfileName(data?.name || nextUser.user_metadata?.full_name || nextUser.user_metadata?.name || '');
    }
    platformSupabase.auth.getSession().then(({ data }) => loadIdentity(data.session));
    const { data: listener } = platformSupabase.auth.onAuthStateChange((_event, session) => { void loadIdentity(session); });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function handleSignOut() {
    await platformSupabase.auth.signOut();
    setUser(null);
    setProfileName('');
  }

  const identityLabel = profileName ? `${profileName}님 환영합니다.` : `${user?.email || ''}님 환영합니다.`;
  const accountActions = user ? <><span className="header-user" title={user.email}>{identityLabel}</span><button type="button" className="header-logout" onClick={handleSignOut}>로그아웃</button></> : <Link href="/login">로그인</Link>;

  return (
    <header className="header glass">
      <div className="container header-content">
        {temporary ? (
          <div className="logo"><Image className="logo-mark" src="/images/cruises/logo2.png" alt="SH" width={187} height={183} /><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></div>
        ) : (
          <Link href="/" className="logo"><Image className="logo-mark" src="/images/cruises/logo2.png" alt="SH" width={187} height={183} /><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></Link>
        )}

        <nav className={`nav-links ${menuOpen ? 'open' : ''}`} aria-label="주요 메뉴">
          {NAV_ITEMS.map((item) => <Link href={item.href} key={item.href} className={pathname === item.href ? 'active' : ''}>{item.label}</Link>)}
          <div className="mobile-auth">{accountActions}</div>
        </nav>

        <div className="auth-buttons">{accountActions}</div>
        <button type="button" className="menu-toggle" aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><i /><i /><i /></button>
      </div>
    </header>
  );
}
