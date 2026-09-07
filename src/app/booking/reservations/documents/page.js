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

function checkoutDate(value, nights) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + (Number(nights) || 1));
  return date.toISOString().slice(0, 10);
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
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function loadDocuments(userId) {
  if (!userId) throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
  const { data: reservations, error: reservationError } = await platformSupabase
    .from('reservation')
    .select('re_id,re_quote_id,reservation_date')
    .eq('re_user_id', userId)
    .eq('re_type', 'cruise')
    .order('reservation_date', { ascending: true });
  if (reservationError) throw reservationError;
  const reservationIds = (reservations || []).map((item) => item.re_id);
  if (!reservationIds.length) return { cruises: [], passports: [] };

  const [cruiseResult, documentResult] = await Promise.all([
    platformSupabase.from('reservation_cruise').select('reservation_id,checkin,room_price_code,boarding_code').in('reservation_id', reservationIds),
    platformSupabase.from('cruise_document').select('id,reservation_id,document_type,image_data,created_at,checkout_date').eq('user_id', userId).in('reservation_id', reservationIds).order('created_at', { ascending: false }),
  ]);
  if (cruiseResult.error) throw cruiseResult.error;
  if (documentResult.error) throw documentResult.error;
  const roomCodes = [...new Set((cruiseResult.data || []).map((item) => item.room_price_code).filter(Boolean))];
  let rateById = new Map();
  if (roomCodes.length) {
    const { data: rates, error: rateError } = await platformSupabase.from('cruise_rate_card').select('id,cruise_name,room_type,schedule_type').in('id', roomCodes);
    if (rateError) throw rateError;
    rateById = new Map((rates || []).map((item) => [item.id, item]));
  }
  const documents = documentResult.data || [];
  return {
    passports: documents.filter((item) => item.document_type === 'passport'),
    cruises: (cruiseResult.data || []).map((item) => ({
      ...item,
      reservation: reservations.find((reservation) => reservation.re_id === item.reservation_id),
      rate: rateById.get(item.room_price_code),
      boardingImages: documents.filter((document) => document.document_type === 'boarding_code' && document.reservation_id === item.reservation_id),
    })),
  };
}

export default function ReservationDocumentsPage() {
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const userIdRef = useRef('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '', userId: '', cruises: [], passports: [] });

  async function refresh() {
    try {
      let userId = userIdRef.current;
      if (!userId) {
        const { data: auth, error } = await platformSupabase.auth.getUser();
        if (error || !auth.user) throw new Error('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
        userId = auth.user.id;
        userIdRef.current = userId;
      }
      const result = await loadDocuments(userId);
      setState((previous) => ({ ...previous, loading: false, error: '', userId, cruises: result.cruises, passports: result.passports }));
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
      const imageData = await Promise.all(files.map(resizeImage));
      const rows = imageData.map((image) => ({
        user_id: state.userId,
        reservation_id: targetCruise.reservation_id,
        document_type: 'passport',
        image_data: image,
        checkout_date: checkoutDate(targetCruise.checkin, String(targetCruise.rate?.schedule_type || '').match(/\d+/)?.[0]),
      }));
      const { error } = await platformSupabase.from('cruise_document').insert(rows);
      if (error) {
        if (String(error.message || '').includes('idx_cruise_document_passport_user')) throw new Error('여권을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        throw error;
      }
      await refresh();
      setState((previous) => ({ ...previous, notice: `${files.length}장의 여권을 등록했습니다.` }));
    } catch (uploadError) {
      setState((previous) => ({ ...previous, saving: false, error: uploadError.message || '여권 업로드에 실패했습니다.' }));
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
      <section className="booking-panel document-upload-panel"><div className="booking-panel-head"><span>PASSENGER PASSPORTS</span><h2>탑승객 여권</h2><p>여러 명의 여권 사진을 한 번에 선택하거나 휴대폰 카메라로 촬영해 바로 등록할 수 있습니다.</p></div><div className="booking-panel-body"><div className="document-upload-actions"><div><strong>{state.passports.length}장 등록됨</strong><p>{state.cruises.length ? `연결 예약: ${state.cruises[0].rate?.cruise_name || '크루즈'} · ${formatDate(state.cruises[0].checkin)}` : '등록 가능한 크루즈 예약이 없습니다.'}</p></div><div className="document-upload-buttons"><input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={uploadPassports} /><input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={uploadPassports} /><button className="booking-action secondary" type="button" disabled={state.saving || !state.cruises.length} onClick={() => cameraInput.current?.click()}>카메라로 촬영</button><button className="booking-action primary" type="button" disabled={state.saving || !state.cruises.length} onClick={() => fileInput.current?.click()}>{state.saving ? '저장 중…' : '사진에서 추가'}</button></div></div>{state.notice && <p className="booking-sync-note">{state.notice}</p>}{state.passports.length > 0 && <div className="document-image-grid">{state.passports.map((document, index) => <a key={document.id} href={document.image_data} target="_blank" rel="noreferrer" className="document-image-card"><img src={document.image_data} alt={`탑승객 여권 ${index + 1}`} /><span>여권 {index + 1} · {formatDate(document.created_at)}</span></a>)}</div>}</div></section>
      <section className="document-cruise-list"><div className="document-section-heading"><span>BOARDING INFORMATION</span><h2>크루즈 승선코드</h2><p>예약 확정 후 승선코드와 이미지를 확인할 수 있습니다.</p></div>{state.cruises.length === 0 && <div className="booking-empty"><h2>크루즈 예약이 없습니다.</h2><p>크루즈 예약이 생성되면 여권 등록 및 승선코드 확인이 가능해집니다.</p></div>}{state.cruises.map((cruise) => <article className="booking-panel document-cruise-card" key={cruise.reservation_id}><div className="booking-panel-head"><span>{formatDate(cruise.checkin)}</span><h2>{cruise.rate?.cruise_name || '크루즈 예약'}</h2><p>{cruise.rate?.room_type || '객실 정보 확인 중'} · 예약번호 {String(cruise.reservation_id).slice(0, 8).toUpperCase()}</p></div><div className="booking-panel-body"><dl className="document-code-grid"><div><dt>승선 코드</dt><dd>{cruise.boarding_code || '예약 확정 후 표시'}</dd></div><div><dt>승선일</dt><dd>{formatDate(cruise.checkin)}</dd></div></dl>{cruise.boardingImages.length > 0 ? <div className="document-image-grid boarding-images">{cruise.boardingImages.map((document, index) => <a key={document.id} href={document.image_data} target="_blank" rel="noreferrer" className="document-image-card"><img src={document.image_data} alt={`${cruise.rate?.cruise_name || '크루즈'} 승선코드 ${index + 1}`} /><span>승선코드 이미지 보기 ↗</span></a>)}</div> : <p className="document-pending">승선코드 이미지는 예약 확정 후 이곳에 표시됩니다.</p>}</div></article>)}</section>
    </>}
    <div className="booking-warning">여권 이미지는 크루즈 일정에 연결되어 보관되며, 승선코드는 예약 확정 후 표시됩니다.</div>
  </div></div>;
}
