'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import { supabase } from '@/lib/supabase';
import BookingCartLink from '@/components/BookingCartLink';
import './Header.css';

const NAV_ITEMS = [
  { href: '/', label: '홈' },
  { href: '/cruises', label: '크루즈' },
  { href: '/hotels', label: '호텔' },
  { href: '/booking', label: '예약' },
  { href: '/booking/reservations', label: '예약내역' },
  { href: '/travel-guide', label: '여행 가이드' },
  { href: '/faq', label: '고객센터' },
];

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [profileName, setProfileName] = useState('');
  const temporary = pathname === '/';

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
    let homepageListener;
    async function loadSessions() {
      const { data: homepage } = await supabase.auth.getSession();
      if (homepage.session) return loadIdentity(homepage.session);
      const { data: platform } = await platformSupabase.auth.getSession();
      return loadIdentity(platform.session);
    }
    void loadSessions();
    const { data: listener } = platformSupabase.auth.onAuthStateChange((_event, session) => { if (session) void loadIdentity(session); });
    const { data: homepageAuthListener } = supabase.auth.onAuthStateChange((_event, session) => { if (session) void loadIdentity(session); else void loadSessions(); });
    homepageListener = homepageAuthListener;
    return () => { mounted = false; listener.subscription.unsubscribe(); homepageListener?.subscription.unsubscribe(); };
  }, []);

  async function handleSignOut() {
    await Promise.all([platformSupabase.auth.signOut(), supabase.auth.signOut()]);
    setUser(null);
    setProfileName('');
  }

  const identityLabel = profileName ? `${profileName}님 환영합니다.` : `${user?.email || ''}님 환영합니다.`;
  const accountActions = user ? <><span className="header-user" title={user.email}>{identityLabel}</span><button type="button" className="header-logout" onClick={handleSignOut}>로그아웃</button></> : <Link href="/login">로그인</Link>;
  const adminLink = <Link href="/admin" className="header-admin">관리자</Link>;
  const homePreviewLink = <Link href="/temp-home" className="header-home-preview">임시 첫화면</Link>;
  const searchForm = <form className="site-search" action="/search" role="search"><label className="sr-only" htmlFor="site-search-input">홈페이지 검색</label><input id="site-search-input" name="q" type="search" placeholder="사이트 검색" /><button type="submit" aria-label="검색">검색</button></form>;

  return (
    <header className="header glass">
      <div className="container header-content">
        <Link href="/" className="logo"><Image className="logo-title" src="/stayhalong_title.png" alt="STAY HALONG — CURATED BAY JOURNEYS" width={1500} height={400} priority /></Link>

        {!temporary && <>
          <nav className={`nav-links ${menuOpen ? 'open' : ''}`} aria-label="주요 메뉴">
            {NAV_ITEMS.map((item) => <Link href={item.href} key={item.href} className={pathname === item.href ? 'active' : ''}>{item.label}</Link>)}
            <div className="mobile-auth">{homePreviewLink}{searchForm}<BookingCartLink mobile />{adminLink}{accountActions}</div>
          </nav>

          <div className="auth-buttons">{homePreviewLink}{searchForm}<BookingCartLink />{adminLink}{accountActions}</div>
          <button type="button" className="menu-toggle" aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><i /><i /><i /></button>
        </>}
      </div>
    </header>
  );
}
