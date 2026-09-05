'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CRITERION_LABELS = {
  default: '기본 추천', family: '가족 편의', couple: '커플·휴식', balcony: '전망·발코니', quiet: '조용한 휴식', activity: '시설·액티비티', value: '합리적인 가격', luxury: 'VIP 서비스',
};

function sameOrder(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function moveItem(items, itemId, nextIndex) {
  const currentIndex = items.indexOf(itemId);
  if (currentIndex < 0) return items;
  const boundedIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
  if (boundedIndex === currentIndex) return items;
  const next = [...items];
  next.splice(currentIndex, 1);
  next.splice(boundedIndex, 0, itemId);
  return next;
}

function formatSavedAt(value) {
  if (!value) return '저장 이력 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '저장 시각 확인 필요' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function HotelRecommendationPriorityPanel({ adminRequest, hotels, serviceTags, operatorRole }) {
  const [criterion, setCriterion] = useState('default');
  const [order, setOrder] = useState([]);
  const [savedOrder, setSavedOrder] = useState([]);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draggedId, setDraggedId] = useState('');
  const loadSequence = useRef(0);

  const activeHotels = useMemo(() => hotels.filter((hotel) => hotel.is_active).sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko')), [hotels]);
  const activeHotelIds = useMemo(() => new Set(activeHotels.map((hotel) => hotel.id)), [activeHotels]);
  const criteria = useMemo(() => ['default', ...new Set(serviceTags.filter((tag) => tag.is_active && activeHotelIds.has(tag.product_id)).map((tag) => tag.tag))].map((tag) => ({ tag, label: CRITERION_LABELS[tag] || `#${tag}` })), [activeHotelIds, serviceTags]);
  const eligibleHotels = useMemo(() => {
    if (criterion === 'default') return activeHotels;
    const taggedIds = new Set(serviceTags.filter((tag) => tag.is_active && tag.tag === criterion).map((tag) => tag.product_id));
    return activeHotels.filter((hotel) => taggedIds.has(hotel.id));
  }, [activeHotels, criterion, serviceTags]);
  const hotelById = useMemo(() => new Map(hotels.map((hotel) => [hotel.id, hotel])), [hotels]);
  const eligibleIds = useMemo(() => eligibleHotels.map((hotel) => hotel.id), [eligibleHotels]);
  const canEdit = operatorRole === 'admin' || operatorRole === 'manager';
  const isDirty = !sameOrder(order, savedOrder);

  const loadPriorities = useCallback(async () => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await adminRequest(`/api/admin/hotel-recommendation-priorities?criterion=${encodeURIComponent(criterion)}`);
      if (sequence !== loadSequence.current) return;
      const eligible = new Set(eligibleIds);
      const rankedIds = (result.priorities || []).map((item) => item.product_id).filter((id) => eligible.has(id));
      const rankedSet = new Set(rankedIds);
      const nextOrder = [...rankedIds, ...eligibleIds.filter((id) => !rankedSet.has(id))];
      setOrder(nextOrder); setSavedOrder(nextOrder);
      setRevision(Number(result.scope?.revision) || 0);
      setUpdatedAt(result.scope?.updated_at || null);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setOrder(eligibleIds); setSavedOrder(eligibleIds);
      setError(loadError.message || '호텔 추천순위를 불러오지 못했습니다.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [adminRequest, criterion, eligibleIds]);

  useEffect(() => { queueMicrotask(() => { void loadPriorities(); }); }, [loadPriorities]);

  function move(productId, nextIndex) {
    if (!canEdit || saving) return;
    setOrder((current) => moveItem(current, productId, nextIndex));
    setNotice(''); setError('');
  }

  function dropAt(targetId) {
    if (!draggedId || draggedId === targetId) return;
    setOrder((current) => moveItem(current, draggedId, current.indexOf(targetId)));
    setDraggedId(''); setNotice('');
  }

  async function savePriorities() {
    if (!canEdit || saving || !isDirty) return;
    setSaving(true); setNotice(''); setError('');
    try {
      const result = await adminRequest('/api/admin/hotel-recommendation-priorities', {
        method: 'PATCH', body: JSON.stringify({ criterionTag: criterion, productIds: order, expectedRevision: revision }),
      });
      setRevision(Number(result.scope?.revision) || revision + 1);
      setUpdatedAt(result.scope?.updatedAt || new Date().toISOString());
      setSavedOrder(order);
      setNotice(`${CRITERION_LABELS[criterion] || `#${criterion}`} 호텔 추천순위를 저장했습니다.`);
    } catch (saveError) {
      setError(saveError.message || '호텔 추천순위를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="priority-manager hotel-priority-manager" aria-labelledby="hotel-priority-manager-title">
    <div className="priority-manager-heading">
      <div><span>HOTEL / EDITORIAL PRIORITY</span><h2 id="hotel-priority-manager-title">호텔 추천순위 편집</h2><p>공개 호텔과 추천 기준에 맞는 호텔만 후보로 표시합니다. 기본 추천 순위는 고객 호텔 목록의 추천순에 반영됩니다.</p></div>
      <dl><div><dt>후보</dt><dd>{eligibleHotels.length}개</dd></div><div><dt>버전</dt><dd>{revision}</dd></div><div><dt>최근 저장</dt><dd>{formatSavedAt(updatedAt)}</dd></div></dl>
    </div>
    <div className="priority-scope">
      <label>추천 기준<select value={criterion} onChange={(event) => setCriterion(event.target.value)} disabled={loading || saving || isDirty}>{criteria.map((item) => <option key={item.tag} value={item.tag}>{item.label}</option>)}</select></label>
      <div><span>적용 범위</span><strong>{CRITERION_LABELS[criterion] || `#${criterion}`} · 전체 호텔</strong><small>저장하지 않은 변경은 저장 또는 취소 후 다른 기준을 선택할 수 있습니다.</small></div>
    </div>
    {error && <p className="priority-feedback error" role="alert">{error}</p>}
    {notice && <p className="priority-feedback success" role="status">{notice}</p>}
    {!canEdit && <p className="priority-feedback read-only">운영자 권한을 확인한 뒤 순위를 변경할 수 있습니다.</p>}
    {loading ? <p className="priority-empty">호텔 추천순위를 불러오는 중…</p> : order.length ? <ol className="priority-list">
      {order.map((productId, index) => {
        const hotel = hotelById.get(productId);
        return <li key={productId} draggable={canEdit && !saving} data-dragging={draggedId === productId} onDragStart={() => setDraggedId(productId)} onDragEnd={() => setDraggedId('')} onDragOver={(event) => { if (canEdit) event.preventDefault(); }} onDrop={() => dropAt(productId)}>
          <span className="priority-position">{String(index + 1).padStart(2, '0')}</span><span className="priority-grip" aria-hidden="true">↕</span>
          <div><strong>{hotel?.manual_override?.name_ko || hotel?.name_ko || '호텔명 없음'}</strong><small>{hotel?.metadata?.location || hotel?.category || hotel?.source_key || productId}</small></div>
          <label>순위<select value={index + 1} onChange={(event) => move(productId, Number(event.target.value) - 1)} disabled={!canEdit || saving}>{order.map((_, optionIndex) => <option key={optionIndex + 1} value={optionIndex + 1}>{optionIndex + 1}위</option>)}</select></label>
          <div className="priority-actions"><button type="button" onClick={() => move(productId, 0)} disabled={!canEdit || saving || index === 0}>맨 위</button><button type="button" onClick={() => move(productId, index - 1)} disabled={!canEdit || saving || index === 0} aria-label={`${hotel?.name_ko || '호텔'} 순위를 위로`}>↑</button><button type="button" onClick={() => move(productId, index + 1)} disabled={!canEdit || saving || index === order.length - 1} aria-label={`${hotel?.name_ko || '호텔'} 순위를 아래로`}>↓</button></div>
        </li>;
      })}
    </ol> : <p className="priority-empty">이 추천 기준에 사용할 수 있는 공개 호텔이 없습니다.</p>}
    <div className="priority-savebar"><p>{isDirty ? '저장하지 않은 순서 변경이 있습니다.' : '서버에 저장된 순서와 같습니다.'}</p><button type="button" className="priority-reset" onClick={() => setOrder(savedOrder)} disabled={!canEdit || saving || !isDirty}>변경 취소</button><button type="button" className="admin-save" onClick={() => { void savePriorities(); }} disabled={!canEdit || saving || loading || !isDirty}>{saving ? '순위 저장 중…' : '순위 저장'}</button></div>
  </section>;
}
