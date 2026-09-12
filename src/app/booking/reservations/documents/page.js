'use client';
/* eslint-disable @next/next/no-img-element -- private, user-uploaded data URLs are not remote image candidates. */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { platformSupabase } from '@/lib/platform-supabase';
import '../../booking.css';

function formatDate(value) {
  if (!value) return '일정 확인 중';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
}

async function resizeImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있습니다.');
  if (file.size > 15 * 1024 * 1024) throw new Error('파일 크기는 15MB 이하여야 합니다.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('이미지를 처리하지 못했습니다.'));
    element.src = source;
  });
  const max = 1600;
  const ratio = Math.min(max / image.width, max / image.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지를 처리하지 못했습니다.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('이미지를 처리하지 못했습니다.')), 'image/jpeg', 0.82);
  });
}

async function authenticatedDocumentRequest(path = '', options = {}) {
  const { data, error } = await platformSupabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
  const response = await fetch(`/api/booking/documents${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '여행 서류를 처리하지 못했습니다.');
  return payload;
}

export default function ReservationDocumentsPage() {
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const userIdRef = useRef('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '', userId: '', cruises: [], passports: [] });
  const [selectedPassportIds, setSelectedPassportIds] = useState([]);

  async function refresh() {
    try {
      let userId = userIdRef.current;
      if (!userId) {
        const { data: auth, error } = await platformSupabase.auth.getUser();
        if (error || !auth.user) throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
        userId = auth.user.id;
        userIdRef.current = userId;
      }
      const result = await authenticatedDocumentRequest();
      setState((previous) => ({ ...previous, loading: false, error: '', userId, cruises: result.cruises, passports: result.passports }));
      setSelectedPassportIds((previous) => previous.filter((id) => result.passports.some((passport) => passport.id === id)));
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error: error.message || '여권·승선코드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: auth, error } = await platformSupabase.auth.getUser();
      if (cancelled) return;
      if (error || !auth.user) {
        window.location.replace(`/login?next=${encodeURIComponent('/booking/reservations/documents')}`);
        return;
      }
      userIdRef.current = auth.user.id;
      if (!cancelled) await refresh();
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function uploadPassports(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const targetCruise = state.cruises.find((item) => item.checkin) || state.cruises[0];
    if (!files.length || !targetCruise || !state.userId) return;
    try {
      setState((previous) => ({ ...previous, saving: true, error: '', notice: '' }));
      for (const file of files) {
        const image = await resizeImage(file);
        const prepared = await authenticatedDocumentRequest('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'prepare-passport-upload', reservationId: targetCruise.reservation_id, contentType: image.type }),
        });
        const upload = await fetch(prepared.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': image.type, 'Cache-Control': 'private, no-store' },
          body: image,
        });
        if (!upload.ok) throw new Error('여권 이미지 저장에 실패했습니다. 다시 시도해 주세요.');
        await authenticatedDocumentRequest('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete-passport-upload', reservationId: targetCruise.reservation_id, path: prepared.path }),
        });
      }
      await refresh();
      setState((previous) => ({ ...previous, notice: `${files.length}장의 여권을 등록했습니다.` }));
    } catch (uploadError) {
      setState((previous) => ({ ...previous, saving: false, error: uploadError.message || '여권 업로드에 실패했습니다.' }));
    } finally {
      setState((previous) => ({ ...previous, saving: false }));
    }
  }

  function togglePassportSelection(id) {
    setSelectedPassportIds((previous) => previous.includes(id) ? previous.filter((selectedId) => selectedId !== id) : [...previous, id]);
  }

  function toggleAllPassports() {
    setSelectedPassportIds((previous) => previous.length === state.passports.length ? [] : state.passports.map((passport) => passport.id));
  }

  async function deletePassports(ids) {
    const documentIds = [...new Set(ids)].filter(Boolean);
    if (!documentIds.length || !state.userId) return;
    if (!window.confirm(`${documentIds.length}장의 여권 사진을 삭제할까요? 삭제한 사진은 복구할 수 없습니다.`)) return;
    try {
      setState((previous) => ({ ...previous, saving: true, error: '', notice: '' }));
      await authenticatedDocumentRequest('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-passports', documentIds }),
      });
      await refresh();
      setSelectedPassportIds([]);
      setState((previous) => ({ ...previous, notice: `${documentIds.length}장의 여권을 삭제했습니다.` }));
    } catch (deleteError) {
      setState((previous) => ({ ...previous, error: deleteError.message || '여권 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.' }));
    } finally {
      setState((previous) => ({ ...previous, saving: false }));
    }
  }

  return <div className="booking-page"><div className="booking-shell">
    <Link href="/booking" className="booking-back">← 예약 홈</Link>
    <div className="booking-title-row"><div><span className="booking-section-kicker">TRAVEL DOCUMENTS</span><h1>여권 · 승선코드</h1></div><span className="beta-badge">TRAVEL DOCUMENTS</span></div>
    <nav className="reservation-tabs" aria-label="예약 메뉴">
      <Link className="reservation-tab" href="/booking/reservations">예약 내역</Link>
      <Link className="reservation-tab active" href="/booking/reservations/documents" aria-current="page">여권 · 승선코드</Link>
    </nav>
    {state.loading && <div className="booking-empty"><h2>여행 서류를 확인하고 있습니다.</h2><p>예약에 연결된 여권과 승선코드를 불러오는 중입니다.</p></div>}
    {!state.loading && state.error && <div className="booking-empty"><h2>확인이 필요합니다.</h2><p>{state.error}</p><button className="booking-action primary" type="button" onClick={() => void refresh()}>다시 시도</button></div>}
    {!state.loading && !state.error && <>
      <section className="booking-panel document-upload-panel"><div className="booking-panel-head"><span>PASSENGER PASSPORTS</span><h2>탑승객 여권</h2><p>여러 명의 여권 사진을 한 번에 선택하거나 휴대폰 카메라로 촬영해 바로 등록할 수 있습니다.</p></div><div className="booking-panel-body"><div className="document-upload-actions"><div><strong>{state.passports.length}장 등록됨</strong><p>{state.cruises.length ? `연결 예약: ${state.cruises[0].rate?.cruise_name || '크루즈'} · ${formatDate(state.cruises[0].checkin)}` : '등록 가능한 크루즈 예약이 없습니다.'}</p></div><div className="document-upload-buttons"><input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={uploadPassports} /><input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={uploadPassports} /><button className="booking-action secondary" type="button" disabled={state.saving || !state.cruises.length} onClick={() => cameraInput.current?.click()}>카메라로 촬영</button><button className="booking-action primary" type="button" disabled={state.saving || !state.cruises.length} onClick={() => fileInput.current?.click()}>{state.saving ? '저장 중…' : '사진에서 추가'}</button></div></div>{state.notice && <p className="booking-sync-note">{state.notice}</p>}{state.passports.length > 0 && <><div className="document-selection-actions"><label className="document-select-all"><input type="checkbox" checked={selectedPassportIds.length === state.passports.length} onChange={toggleAllPassports} disabled={state.saving} /> 전체 선택</label><span>{selectedPassportIds.length}장 선택됨</span><button className="document-delete-button" type="button" disabled={state.saving || selectedPassportIds.length === 0} onClick={() => void deletePassports(selectedPassportIds)}>{state.saving ? '처리 중…' : '선택 삭제'}</button></div><div className="document-image-grid">{state.passports.map((document, index) => { const selected = selectedPassportIds.includes(document.id); const imageUrl = document.image_url || document.image_data; return <article key={document.id} className={`document-image-card ${selected ? 'selected' : ''}`}><label className="document-image-select"><input type="checkbox" checked={selected} onChange={() => togglePassportSelection(document.id)} disabled={state.saving} /><span>여권 {index + 1} 선택</span></label><a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={`탑승객 여권 ${index + 1}`} /><span>여권 {index + 1} · {formatDate(document.created_at)}</span></a><button className="document-delete-button individual" type="button" disabled={state.saving} onClick={() => void deletePassports([document.id])}>삭제</button></article>; })}</div></>}</div></section>
      <section className="document-cruise-list"><div className="document-section-heading"><span>BOARDING INFORMATION</span><h2>크루즈 승선코드</h2><p>예약 확정 후 승선코드와 이미지를 확인할 수 있습니다.</p></div>{state.cruises.length === 0 && <div className="booking-empty"><h2>크루즈 예약이 없습니다.</h2><p>크루즈 예약이 생성되면 여권 등록 및 승선코드 확인이 가능해집니다.</p></div>}{state.cruises.map((cruise) => <article className="booking-panel document-cruise-card" key={cruise.reservation_id}><div className="booking-panel-head"><span>{formatDate(cruise.checkin)}</span><h2>{cruise.rate?.cruise_name || '크루즈 예약'}</h2><p>{cruise.rate?.room_type || '객실 정보 확인 중'} · 예약번호 {String(cruise.reservation_id).slice(0, 8).toUpperCase()}</p></div><div className="booking-panel-body"><dl className="document-code-grid"><div><dt>승선 코드</dt><dd>{cruise.boarding_code || '예약 확정 후 표시'}</dd></div><div><dt>승선일</dt><dd>{formatDate(cruise.checkin)}</dd></div></dl>{cruise.boardingImages.length > 0 ? <div className="document-image-grid boarding-images">{cruise.boardingImages.map((document, index) => { const imageUrl = document.image_url || document.image_data; return <a key={document.id} href={imageUrl} target="_blank" rel="noreferrer" className="document-image-card"><img src={imageUrl} alt={`${cruise.rate?.cruise_name || '크루즈'} 승선코드 ${index + 1}`} /><span>승선코드 이미지 보기 ↗</span></a>; })}</div> : <p className="document-pending">승선코드 이미지는 예약 확정 후 이곳에 표시됩니다.</p>}</div></article>)}</section>
    </>}
    <div className="booking-warning">여권 이미지는 크루즈 일정에 연결되어 보관되며, 승선코드는 예약 확정 후 표시됩니다.</div>
  </div></div>;
}
