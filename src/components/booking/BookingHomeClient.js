// 고객앱과 같은 견적 선택 흐름으로 홈페이지 예약 서비스 목록을 표시한다.
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import BookingCartLink from '@/components/BookingCartLink';
import { platformSupabase } from '@/lib/platform-supabase';

const SERVICES = [
  { key: 'cruise', name: '크루즈 예약', copy: '출항일, 일정, 크루즈와 객실 구성을 선택합니다.' },
  { key: 'cruise_vehicle', name: '크루즈 차량만 추가', copy: '내 크루즈 예약을 선택하고 선착장 이동 차량을 추가합니다.' },
  { key: 'airport', name: '공항 서비스 예약', copy: '공항 픽업·샌딩의 경로와 차량, 항공편을 선택합니다.' },
  { key: 'hotel', name: '호텔 예약', copy: '체크인·체크아웃 날짜와 호텔 객실을 선택합니다.' },
  { key: 'rentcar', name: '렌터카 예약', copy: '이용 방식, 경로, 차량과 왕복 일정을 선택합니다.' },
  { key: 'tour', name: '투어 예약', copy: '투어, 인원 요금, 결제 방식과 픽업 장소를 선택합니다.' },
  { key: 'package', name: '패키지 예약', copy: '크루즈·공항·투어가 포함된 패키지와 인원 옵션을 선택합니다.' },
  { key: 'ticket', name: '티켓 예약', copy: '티켓 종류, 프로그램, 인원과 셔틀을 선택합니다.' },
];

export default function BookingHomeClient() {
  const [state, setState] = useState({ loading: true, user: null, profile: null, quotes: [], activeQuoteId: '', completed: {}, error: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const auth = await platformSupabase.auth.getUser();
      if (cancelled) return;
      if (!auth.data.user) { setState((current) => ({ ...current, loading: false })); return; }
      const user = auth.data.user;
      const [profile, quotes] = await Promise.all([
        platformSupabase.from('users').select('name,email,english_name,phone_number').eq('id', user.id).maybeSingle(),
        platformSupabase.from('quote').select('id,title,status,created_at').eq('user_id', user.id).in('status', ['draft', 'approved']).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      if (quotes.error) { setState({ loading: false, user, profile: profile.data, quotes: [], activeQuoteId: '', completed: {}, error: '견적 목록을 불러오지 못했습니다.' }); return; }
      const sorted = [...(quotes.data || [])].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
      const requested = new URLSearchParams(window.location.search).get('quoteId');
      const active = sorted.find((quote) => quote.id === requested) || sorted[0] || null;
      setState({ loading: false, user, profile: profile.data, quotes: sorted, activeQuoteId: active?.id || '', completed: {}, error: '' });
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCompleted() {
      if (!state.user || !state.activeQuoteId) { setState((current) => ({ ...current, completed: {} })); return; }
      const result = await platformSupabase.from('reservation').select('re_type,re_status,re_created_at').eq('re_user_id', state.user.id).eq('re_quote_id', state.activeQuoteId).order('re_created_at', { ascending: false });
      if (cancelled || result.error) return;
      const completed = {};
      for (const row of result.data || []) if (!completed[row.re_type]) completed[row.re_type] = row.re_status;
      setState((current) => ({ ...current, completed }));
    }
    void loadCompleted();
    return () => { cancelled = true; };
  }, [state.activeQuoteId, state.user]);

  const activeQuote = useMemo(() => state.quotes.find((quote) => quote.id === state.activeQuoteId), [state.activeQuoteId, state.quotes]);

  async function createQuote() {
    if (!state.user || creating) return;
    setCreating(true);
    try {
      const existingDraft = state.quotes.find((quote) => quote.status === 'draft');
      if (existingDraft) { setState((current) => ({ ...current, activeQuoteId: existingDraft.id })); return; }
      const all = await platformSupabase.from('quote').select('id').eq('user_id', state.user.id);
      if (all.error) throw all.error;
      const name = state.profile?.name || state.user.email?.split('@')[0] || '고객';
      const created = await platformSupabase.from('quote').insert({ user_id: state.user.id, title: `${name}${(all.data || []).length + 1}`, status: 'draft' }).select('id,title,status,created_at').single();
      if (created.error) throw created.error;
      setState((current) => ({ ...current, quotes: [created.data, ...current.quotes], activeQuoteId: created.data.id, error: '' }));
    } catch {
      setState((current) => ({ ...current, error: '새 견적을 생성하지 못했습니다.' }));
    } finally { setCreating(false); }
  }

  const href = (key) => `/booking/service/${key}${state.activeQuoteId ? `?quoteId=${encodeURIComponent(state.activeQuoteId)}` : ''}`;

  return <div className="booking-page">
    <section className="booking-hero"><div className="container"><span className="booking-kicker">CUSTOMER BOOKING</span><h1>행복 여행 예약</h1><p>고객앱과 같은 상품 목록과 예약 흐름을 홈페이지 디자인으로 이용하세요. 선택 초안은 홈페이지 DB 장바구니에 보관됩니다.</p><div className="booking-hero-actions"><BookingCartLink className="booking-action primary" showCount={false} header={false}>여행 장바구니 →</BookingCartLink><Link href="/booking/reservations" className="booking-action primary">내 예약 확인 →</Link></div></div></section>
    <section className="booking-section"><div className="container">
      <div className="booking-section-head"><div><span className="booking-section-kicker">01 / SELECT A QUOTE</span><h2>하나의 견적에<br />여행을 모읍니다.</h2></div><p>고객앱과 동일하게 진행 중인 견적을 선택해 각 서비스를 연결합니다. 패키지는 고객앱 계약에 따라 별도 예약으로 저장됩니다.</p></div>
      {state.loading ? <div className="booking-quote-bar"><p>플랫폼 견적을 확인하고 있습니다.</p></div> : state.user ? <div className="booking-quote-bar"><div><span>ACTIVE QUOTE</span><strong>{activeQuote?.title || '첫 예약 · 최종 저장 시 견적 생성'}</strong><small>{activeQuote ? (activeQuote.status === 'approved' ? '승인 견적' : '작성 중 견적') : '진행 중 견적이 없습니다.'}</small></div><div className="booking-quote-actions">{state.quotes.length > 0 && <select aria-label="견적 선택" value={state.activeQuoteId} onChange={(event) => setState((current) => ({ ...current, activeQuoteId: event.target.value }))}>{state.quotes.map((quote) => <option value={quote.id} key={quote.id}>{quote.title} · {quote.status === 'approved' ? '승인' : '작성 중'}</option>)}</select>}<button type="button" disabled={creating} onClick={createQuote}>{creating ? '생성 중…' : '새 예약 만들기'}</button></div></div> : <div className="booking-quote-bar"><div><span>PLATFORM LOGIN</span><strong>로그인 후 장바구니를 저장할 수 있습니다.</strong><small>서비스 선택 중 로그인하면 입력 내용을 이어서 보관합니다.</small></div><Link className="booking-action primary" href="/login?next=/booking">로그인 →</Link></div>}
      {state.error && <p className="booking-error">{state.error}</p>}
      <div className="booking-section-head booking-service-heading"><div><span className="booking-section-kicker">02 / CHOOSE A SERVICE</span><h2>여행에 필요한<br />모든 예약.</h2></div><p>서비스 순서, 목록값, 연속 필터와 입력 단계는 플랫폼 고객앱을 기준으로 합니다.</p></div>
      <div className="service-grid">{SERVICES.map((service, index) => { const status = service.key === 'cruise_vehicle' ? (state.completed.car || state.completed.sht) : state.completed[service.key]; return <article className="service-card" key={service.key}><span className="service-index">{String(index + 1).padStart(2, '0')} / SERVICE</span><h3>{service.name}</h3><p>{service.copy}</p>{status && <span className="service-status">{status === 'approved' ? '승인' : '저장됨'} · {status}</span>}<div className="service-actions"><Link href={href(service.key)} className="service-link">예약하기 →</Link></div></article>; })}</div>
    </div></section>
  </div>;
}
