'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CRITERION_LABELS = {
  default: '기본 추천',
  family: '가족 편의',
  couple: '허니문·커플',
  balcony: '전용 발코니',
  quiet: '조용한 휴식',
  activity: '시설·액티비티',
  value: '합리적인 가격',
  luxury: 'VIP 서비스',
  honeymoon: '허니문',
  'senior-friendly': '부모님 동반',
  spa: '스파·웰니스',
  'fine-dining': '프리미엄 다이닝',
  'small-ship': '소규모 선박',
};
const SCHEDULE_OPTIONS = [
  ['ALL', '전체 일정'],
  ['DAY', '당일'],
  ['1N2D', '1박 2일'],
  ['2N3D', '2박 3일'],
];

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

export default function RecommendationPriorityPanel({ adminRequest, cruises, itineraries, tags, operatorRole }) {
  const [criterion, setCriterion] = useState('default');
  const [schedule, setSchedule] = useState('ALL');
  const [order, setOrder] = useState([]);
  const [savedOrder, setSavedOrder] = useState([]);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draggedId, setDraggedId] = useState('');
  const loadSequence = useRef(0);

  const criteria = useMemo(() => {
    const activeTags = tags.filter((tag) => tag.is_active).map((tag) => tag.tag);
    return ['default', ...new Set(activeTags)].map((tag) => ({ tag, label: CRITERION_LABELS[tag] || `#${tag}` }));
  }, [tags]);

  const eligibleCruises = useMemo(() => {
    const itineraryCruiseIds = schedule === 'ALL'
      ? null
      : new Set(itineraries.filter((item) => item.is_active && item.schedule_type === schedule).map((item) => item.cruise_id));
    const tagCruiseIds = criterion === 'default'
      ? null
      : new Set(tags.filter((tag) => tag.is_active && tag.tag === criterion).map((tag) => tag.cruise_id));
    return cruises
      .filter((cruise) => cruise.is_active)
      .filter((cruise) => !itineraryCruiseIds || itineraryCruiseIds.has(cruise.id))
      .filter((cruise) => !tagCruiseIds || tagCruiseIds.has(cruise.id))
      .sort((left, right) => left.name_ko.localeCompare(right.name_ko, 'ko'));
  }, [criterion, cruises, itineraries, schedule, tags]);

  const cruiseById = useMemo(() => new Map(cruises.map((cruise) => [cruise.id, cruise])), [cruises]);
  const eligibleIds = useMemo(() => eligibleCruises.map((cruise) => cruise.id), [eligibleCruises]);
  const isDirty = !sameOrder(order, savedOrder);
  const canEdit = operatorRole === 'admin';

  const loadPriorities = useCallback(async () => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams({ criterion, schedule });
      const result = await adminRequest(`/api/admin/recommendation-priorities?${params}`);
      if (sequence !== loadSequence.current) return;
      const eligible = new Set(eligibleIds);
      const rankedIds = (result.priorities || []).map((item) => item.cruise_id).filter((id) => eligible.has(id));
      const nextOrder = [...rankedIds, ...eligibleIds.filter((id) => !rankedIds.includes(id))];
      setOrder(nextOrder);
      setSavedOrder(nextOrder);
      setRevision(Number(result.scope?.revision) || 0);
      setUpdatedAt(result.scope?.updated_at || null);
      setUpdatedBy(result.scope?.updated_by || null);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setOrder(eligibleIds);
      setSavedOrder(eligibleIds);
      setError(loadError.message || '추천순위를 불러오지 못했습니다.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [adminRequest, criterion, eligibleIds, schedule]);

  useEffect(() => { queueMicrotask(() => { void loadPriorities(); }); }, [loadPriorities]);

  function move(cruiseId, nextIndex) {
    if (!canEdit || saving) return;
    setOrder((current) => moveItem(current, cruiseId, nextIndex));
    setNotice('');
    setError('');
  }

  function dropAt(targetId) {
    if (!draggedId || draggedId === targetId) return;
    setOrder((current) => {
      const targetIndex = current.indexOf(targetId);
      return moveItem(current, draggedId, targetIndex);
    });
    setDraggedId('');
    setNotice('');
  }

  async function savePriorities() {
    if (!canEdit || saving || !isDirty) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = await adminRequest('/api/admin/recommendation-priorities', {
        method: 'PATCH',
        body: JSON.stringify({ criterionTag: criterion, scheduleType: schedule, cruiseIds: order, expectedRevision: revision }),
      });
      setRevision(Number(result.scope?.revision) || revision + 1);
      setUpdatedAt(result.scope?.updatedAt || new Date().toISOString());
      setUpdatedBy(result.scope?.updatedBy || null);
      setSavedOrder(order);
      setNotice(`${CRITERION_LABELS[criterion] || `#${criterion}`} · ${SCHEDULE_OPTIONS.find(([value]) => value === schedule)?.[1]} 추천순위를 저장했습니다.`);
    } catch (saveError) {
      setError(saveError.message || '추천순위를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="priority-manager" aria-labelledby="priority-manager-title">
    <div className="priority-manager-heading">
      <div>
        <span>03 / EDITORIAL PRIORITY</span>
        <h2 id="priority-manager-title">추천순위 편집</h2>
        <p>고객 조건에 맞는 상품만 남긴 뒤 아래 운영순위를 적용합니다. 1위라도 일정·인원·객실·활성 요금 조건에 맞지 않으면 추천에서 제외됩니다.</p>
      </div>
      <dl>
        <div><dt>후보</dt><dd>{eligibleCruises.length}개</dd></div>
        <div><dt>버전</dt><dd>{revision}</dd></div>
        <div><dt>최근 저장</dt><dd>{formatSavedAt(updatedAt)}</dd></div>
      </dl>
    </div>

    <div className="priority-scope">
      <label>추천 기준<select value={criterion} onChange={(event) => setCriterion(event.target.value)} disabled={loading || saving || isDirty}>{criteria.map((item) => <option key={item.tag} value={item.tag}>{item.label}</option>)}</select></label>
      <label>일정 범위<select value={schedule} onChange={(event) => setSchedule(event.target.value)} disabled={loading || saving || isDirty}>{SCHEDULE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div><span>적용 범위</span><strong>{CRITERION_LABELS[criterion] || `#${criterion}`} · {SCHEDULE_OPTIONS.find(([value]) => value === schedule)?.[1]}</strong><small>{updatedBy ? `작업자 ${updatedBy.slice(0, 8)}…` : '저장 전 기본 순서'}</small></div>
    </div>

    {error && <p className="priority-feedback error" role="alert">{error}</p>}
    {notice && <p className="priority-feedback success" role="status">{notice}</p>}
    {!canEdit && <p className="priority-feedback read-only">관리자 권한에서만 순위를 변경할 수 있습니다. 현재 계정은 조회만 가능합니다.</p>}

    {loading ? <p className="priority-empty">추천순위를 불러오는 중…</p> : order.length ? <ol className="priority-list">
      {order.map((cruiseId, index) => {
        const cruise = cruiseById.get(cruiseId);
        return <li
          key={cruiseId}
          draggable={canEdit && !saving}
          data-dragging={draggedId === cruiseId}
          onDragStart={() => setDraggedId(cruiseId)}
          onDragEnd={() => setDraggedId('')}
          onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
          onDrop={() => dropAt(cruiseId)}
        >
          <span className="priority-position">{String(index + 1).padStart(2, '0')}</span>
          <span className="priority-grip" aria-hidden="true">↕</span>
          <div><strong>{cruise?.name_ko || '크루즈명 없음'}</strong><small>{cruise?.name_en || cruise?.code || cruiseId}</small></div>
          <label>순위<select value={index + 1} onChange={(event) => move(cruiseId, Number(event.target.value) - 1)} disabled={!canEdit || saving}>{order.map((_, optionIndex) => <option key={optionIndex + 1} value={optionIndex + 1}>{optionIndex + 1}위</option>)}</select></label>
          <div className="priority-actions">
            <button type="button" onClick={() => move(cruiseId, 0)} disabled={!canEdit || saving || index === 0}>맨 위</button>
            <button type="button" onClick={() => move(cruiseId, index - 1)} disabled={!canEdit || saving || index === 0} aria-label={`${cruise?.name_ko || '크루즈'} 순위를 위로`}>↑</button>
            <button type="button" onClick={() => move(cruiseId, index + 1)} disabled={!canEdit || saving || index === order.length - 1} aria-label={`${cruise?.name_ko || '크루즈'} 순위를 아래로`}>↓</button>
          </div>
        </li>;
      })}
    </ol> : <p className="priority-empty">이 추천 기준과 일정에 사용할 수 있는 활성 크루즈가 없습니다.</p>}

    <div className="priority-savebar">
      <p>{isDirty ? '저장하지 않은 순서 변경이 있습니다.' : '서버에 저장된 순서와 같습니다.'}</p>
      <button type="button" className="priority-reset" onClick={() => setOrder(savedOrder)} disabled={!canEdit || saving || !isDirty}>변경 취소</button>
      <button type="button" className="admin-save" onClick={() => { void savePriorities(); }} disabled={!canEdit || saving || loading || !isDirty}>{saving ? '순위 저장 중…' : '순위 저장'}</button>
    </div>
  </section>;
}
