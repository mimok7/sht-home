'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../../../booking.css';

const TYPE_LABEL = { cruise: '크루즈', airport: '공항 이동', hotel: '호텔', rentcar: '렌터카', tour: '투어', ticket: '티켓', car: '크루즈 차량', cruise_car: '크루즈 차량', package: '패키지' };

function inputValue(field) {
  if (field.type !== 'datetime-local' || !field.value) return field.value ?? '';
  const date = new Date(field.value);
  if (Number.isNaN(date.getTime())) return String(field.value).slice(0, 16);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

async function platformToken() {
  const { data, error } = await platformSupabase.auth.getSession();
  if (error || !data.session?.access_token) return '';
  return data.session.access_token;
}

export default function ReservationOperationsPage({ params }) {
  const { id } = use(params);
  const [state, setState] = useState({ loading: true, saving: false, error: '', message: '', data: null, values: {} });

  const load = useCallback(async () => {
    const token = await platformToken();
    if (!token) {
      window.location.replace(`/login?next=${encodeURIComponent(`/booking/reservations/${id}/operations`)}`);
      return;
    }
    const response = await fetch(`/api/booking/reservations/${id}/operations`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setState((current) => ({ ...current, loading: false, error: result?.error || '운영정보를 불러오지 못했습니다.' }));
      return;
    }
    const values = {};
    result.groups.forEach((group) => group.fields.forEach((field) => { values[`${group.table}:${group.rowId}:${field.key}`] = inputValue(field); }));
    setState({ loading: false, saving: false, error: '', message: '', data: result, values });
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function setValue(key, value) {
    setState((current) => ({ ...current, error: '', message: '', values: { ...current.values, [key]: value } }));
  }

  async function save(event) {
    event.preventDefault();
    const updates = (state.data?.groups || []).map((group) => {
      const values = {};
      group.fields.filter((field) => !field.locked).forEach((field) => {
        const key = `${group.table}:${group.rowId}:${field.key}`;
        const value = state.values[key];
        if (value !== '' && value !== null && value !== undefined) values[field.key] = value;
      });
      return { table: group.table, rowId: group.rowId, values };
    }).filter((update) => Object.keys(update.values).length);
    if (!updates.length) {
      setState((current) => ({ ...current, error: '새로 입력한 운영정보가 없습니다.' }));
      return;
    }
    setState((current) => ({ ...current, saving: true, error: '', message: '' }));
    const token = await platformToken();
    const response = await fetch(`/api/booking/reservations/${id}/operations`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setState((current) => ({ ...current, saving: false, error: result?.error || '운영정보를 저장하지 못했습니다.' }));
      return;
    }
    await load();
    setState((current) => ({ ...current, message: '운영정보를 저장했습니다. 이미 저장된 정보의 변경은 매니저 승인 절차로 진행됩니다.' }));
  }

  const reservation = state.data?.reservation;
  return <div className="booking-page"><div className="booking-shell">
    <Link href={`/booking/reservations/${id}`} className="booking-back">← 예약 상세</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">AFTER PAYMENT</span><h1>운영정보 입력</h1></div>{reservation && <span className="beta-badge">{TYPE_LABEL[reservation.type] || reservation.type}</span>}</div>
    {state.loading && <div className="booking-empty"><h2>결제 상태와 예약을 확인하고 있습니다.</h2></div>}
    {state.error && <p className="booking-error" role="alert">{state.error}</p>}
    {state.message && <p className="booking-warning" role="status">{state.message}</p>}
    {!state.loading && state.data && !state.data.paid && <div className="booking-empty"><h2>결제 완료 후 입력할 수 있습니다.</h2><p>매니저가 발급한 결제 링크로 결제가 완료되면 픽업·샌딩 장소와 시각 등 운영정보를 입력할 수 있습니다.</p><Link className="booking-action secondary" href={`/booking/reservations/${id}`}>예약 상세로 돌아가기 →</Link></div>}
    {!state.loading && state.data?.paid && state.data.groups.length === 0 && <div className="booking-empty"><h2>추가로 입력할 운영정보가 없습니다.</h2><p>이 예약은 선택한 가격 조건만으로 운영할 수 있습니다.</p></div>}
    {!state.loading && state.data?.paid && state.data.groups.length > 0 && <form className="operations-form" onSubmit={save}>
      <div className="booking-warning">빈 항목만 최초 입력할 수 있습니다. 저장된 정보의 수정은 기존 플랫폼 변경요청을 이용해 주세요.</div>
      {state.data.groups.map((group) => <section className="booking-panel" key={`${group.table}:${group.rowId}`}>
        <div className="booking-panel-head"><span>OPERATION DETAILS</span><h2>{group.title}</h2></div>
        <div className="booking-panel-body booking-fields">{group.fields.map((field) => {
          const key = `${group.table}:${group.rowId}:${field.key}`;
          const value = state.values[key] ?? '';
          return <div className={`booking-field${field.type === 'textarea' ? ' full' : ''}`} key={field.key}><label>{field.label}{field.optional ? ' (선택)' : ''}</label>
            {field.type === 'textarea' ? <textarea value={value} disabled={field.locked} onChange={(event) => setValue(key, event.target.value)} /> : field.type === 'boolean' ? <select value={value === true ? 'true' : value === false ? 'false' : value} disabled={field.locked} onChange={(event) => setValue(key, event.target.value)}><option value="">선택해 주세요</option><option value="true">신청</option><option value="false">미신청</option></select> : <input type={field.type} min={field.type === 'number' ? 0 : undefined} value={value} disabled={field.locked} onChange={(event) => setValue(key, event.target.value)} />}
            {field.locked && <small className="operations-locked">등록 완료 · 변경은 매니저 승인 필요</small>}
          </div>;
        })}</div>
      </section>)}
      <div className="booking-controls"><button type="submit" disabled={state.saving}>{state.saving ? '운영정보 저장 중…' : '운영정보 저장 →'}</button><Link className="secondary" href={`/booking/reservations/${id}`}>예약 상세</Link></div>
    </form>}
  </div></div>;
}
