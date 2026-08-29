'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../booking.css';

const initialDraft = { rateCardId: '', cruiseName: '', roomType: '', schedule: '', checkin: '', adultCount: 2, childCount: 0, infantCount: 0, roomCount: 1, requestNote: '' };

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function CruiseBookingPage() {
  const [draft, setDraft] = useState(initialDraft);
  const [rate, setRate] = useState(null);
  const [state, setState] = useState({ loading: true, error: '', saved: false });

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const params = new URLSearchParams(window.location.search);
      const nextDraft = {
        ...initialDraft,
        rateCardId: params.get('rateCardId') || '',
        cruiseName: params.get('cruiseName') || '',
        roomType: params.get('roomType') || '',
        schedule: params.get('schedule') || '',
        checkin: params.get('checkin') || '',
        adultCount: numberValue(params.get('adultCount'), 2),
        childCount: numberValue(params.get('childCount')),
        infantCount: numberValue(params.get('infantCount')),
        roomCount: Math.max(1, numberValue(params.get('roomCount'), 1)),
      };
      const { data: auth } = await platformSupabase.auth.getUser();
      if (cancelled) return;
      if (!auth.user) {
        const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        window.location.replace(`/login?next=${next}`);
        return;
      }
      if (!nextDraft.rateCardId) {
        setDraft(nextDraft);
        setState({ loading: false, error: '상품 상세에서 객실과 일정을 먼저 선택해 주세요.', saved: false });
        return;
      }
      const { data, error } = await platformSupabase
        .from('cruise_rate_card')
        .select('id,cruise_name,room_type,schedule_type,valid_from,valid_to,price_adult,price_child,price_infant,is_active')
        .eq('id', nextDraft.rateCardId)
        .eq('is_active', true)
        .maybeSingle();
      if (cancelled) return;
      const validDate = data && nextDraft.checkin && (!data.valid_from || data.valid_from <= nextDraft.checkin) && (!data.valid_to || data.valid_to >= nextDraft.checkin);
      if (error || !data || !validDate) {
        setDraft(nextDraft);
        setState({ loading: false, error: '선택한 요금이 플랫폼 원본에서 활성 상태가 아니거나 이용일에 적용되지 않습니다.', saved: false });
        return;
      }
      setRate(data);
      setDraft({ ...nextDraft, cruiseName: data.cruise_name || nextDraft.cruiseName, roomType: data.room_type || nextDraft.roomType, schedule: data.schedule_type || nextDraft.schedule });
      setState({ loading: false, error: '', saved: false });
    }
    void prepare();
    return () => { cancelled = true; };
  }, []);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setState((current) => ({ ...current, saved: false }));
  }

  function saveDraft(event) {
    event.preventDefault();
    const payload = { ...draft, savedAt: new Date().toISOString(), source: 'homepage-booking-beta' };
    window.localStorage.setItem('stayhalong-cruise-booking-draft', JSON.stringify(payload));
    setState((current) => ({ ...current, saved: true }));
  }

  return <div className="booking-page"><div className="booking-shell">
    <Link href="/cruises" className="booking-back">← 크루즈 상품으로</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">CRUISE BOOKING</span><h1>예약 초안</h1></div><span className="beta-badge">NO PLATFORM WRITE</span></div>
    <section className="booking-panel">
      <div className="booking-panel-head"><h2>{state.loading ? '플랫폼 요금 확인 중' : (draft.cruiseName || '크루즈를 선택해 주세요')}</h2></div>
      <form className="booking-panel-body" onSubmit={saveDraft}>
        <div className="booking-fields">
          <div className="booking-field"><label htmlFor="cruise-room">객실</label><input id="cruise-room" value={draft.roomType} readOnly /></div>
          <div className="booking-field"><label htmlFor="cruise-schedule">일정</label><input id="cruise-schedule" value={draft.schedule} readOnly /></div>
          <div className="booking-field"><label htmlFor="cruise-date">이용일</label><input id="cruise-date" type="date" value={draft.checkin} readOnly /></div>
          <div className="booking-field"><label htmlFor="cruise-room-count">객실 수</label><input id="cruise-room-count" type="number" min="1" max="10" value={draft.roomCount} onChange={(event) => update('roomCount', numberValue(event.target.value, 1))} /></div>
          <div className="booking-field"><label htmlFor="cruise-adult">성인</label><input id="cruise-adult" type="number" min="1" max="20" value={draft.adultCount} onChange={(event) => update('adultCount', numberValue(event.target.value, 1))} /></div>
          <div className="booking-field"><label htmlFor="cruise-child">아동</label><input id="cruise-child" type="number" min="0" max="20" value={draft.childCount} onChange={(event) => update('childCount', numberValue(event.target.value))} /></div>
          <div className="booking-field"><label htmlFor="cruise-infant">유아</label><input id="cruise-infant" type="number" min="0" max="10" value={draft.infantCount} onChange={(event) => update('infantCount', numberValue(event.target.value))} /></div>
          <div className="booking-field full"><label htmlFor="cruise-note">요청사항</label><textarea id="cruise-note" value={draft.requestNote} onChange={(event) => update('requestNote', event.target.value)} placeholder="객실 배치, 기념일 등 요청사항을 적어주세요." /></div>
        </div>
        {rate && <dl className="booking-summary"><div><dt>플랫폼 요금 ID</dt><dd>{String(rate.id).slice(0, 8)}</dd></div><div className="booking-summary-price"><dt>성인 등록요금</dt><dd>{Number(rate.price_adult || 0).toLocaleString('ko-KR')} VND</dd></div><div><dt>적용 기간</dt><dd>{rate.valid_from} ~ {rate.valid_to}</dd></div></dl>}
        <div className="booking-warning">현재 단계는 플랫폼 원본 요금의 활성 여부와 적용일을 검증하고 홈페이지에 초안을 저장합니다. 프로모션·휴일 할증·아동 규정 계산 결과가 기존 플랫폼과 일치하기 전에는 플랫폼 예약 행을 만들지 않습니다.</div>
        {state.error && <p className="booking-error" role="alert">{state.error}</p>}
        {state.saved && <p className="booking-warning" role="status">이 기기에 예약 초안을 저장했습니다. 플랫폼 데이터는 변경하지 않았습니다.</p>}
        <div className="booking-controls"><button type="submit" disabled={state.loading || !rate}>초안 저장</button><a className="secondary" href="https://customer.stayhalong.com/mypage/direct-booking/cruise" target="_blank" rel="noreferrer">기존 플랫폼에서 예약 완료 ↗</a></div>
      </form>
    </section>
  </div></div>;
}
