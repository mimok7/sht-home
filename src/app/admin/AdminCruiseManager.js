'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { platformSupabase } from '@/lib/platform-supabase';
import { supabase } from '@/lib/supabase';
import { romanizeKoreanName } from '@/lib/koreanRomanization';

const TAGS = ['family', 'couple', 'balcony', 'quiet', 'activity', 'value', 'luxury'];
const DEFAULT_CAFE_URL = 'https://cafe.naver.com/f-e/cafes/31003053/articles/4918?boardtype=I&menuid=792&referrerAllArticles=false';
const IMAGE_NAME_PRESETS = [
  { value: 'exterior', label: '익스테리어 (exterior)' },
  { value: 'interior', label: '인테리어 (interior)' },
  { value: 'menu', label: '메뉴소개 (menu)' },
];
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };
const CATALOG_SERVICE_LABELS = { cruise: '크루즈', hotel: '호텔', airport: '공항', tour: '투어', vehicle: '차량' };
const CATALOG_SELECTION_GROUP = {
  id: 'catalog-selection', label: '홈페이지 상품 관리',
  items: [
    { id: 'catalog-cruise', label: '크루즈 상품', catalogService: 'cruise' },
    { id: 'catalog-hotel', label: '호텔 상품', catalogService: 'hotel' },
    { id: 'catalog-airport', label: '공항 상품', catalogService: 'airport' },
    { id: 'catalog-tour', label: '투어 상품', catalogService: 'tour' },
    { id: 'catalog-vehicle', label: '차량 상품', catalogService: 'vehicle' },
  ],
};
const CRUISE_OPERATION_GROUP = {
  id: 'cruise', label: '크루즈 운영 데이터',
  items: [
    { id: 'profile', label: '기본 정보' },
    { id: 'tags', label: '추천 기준' },
    { id: 'itinerary', label: '일정 관리' },
    { id: 'cabins', label: '객실 관리' },
    { id: 'rates', label: '요금 관리' },
  ],
};
const SYSTEM_MENU_GROUP = { id: 'system', label: '시스템 관리', adminOnly: true, items: [{ id: 'members', label: '회원 및 권한' }] };

const blankData = { cruises: [], itineraries: [], cabins: [], cabinImages: [], rates: [], tags: [], members: [], roles: [], unmatchedRates: [], catalogProducts: [], catalogPrices: [] };
const string = (value) => value ?? '';
const numeric = (value) => (value === '' || value === null ? null : Number(value));
const fileStem = (value, fallback = 'cabin') => String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
const englishCabinName = (cabin) => String(cabin?.name_en || '').trim() || romanizeKoreanName(cabin?.name_ko);

function dateRange(start, end) {
  if (!start || !end) return null;
  const nextDay = new Date(`${end}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return `[${start},${nextDay.toISOString().slice(0, 10)})`;
}

function editableCruise(cruise) {
  return {
    name_ko: string(cruise.name_ko), name_en: string(cruise.name_en),
    description: string(cruise.description), category: string(cruise.category),
    star_rating: string(cruise.star_rating), hero_image: string(cruise.hero_image),
    is_active: Boolean(cruise.is_active),
  };
}

function ImagePreview({ src, alt }) {
  const imageUrl = typeof src === 'string' ? src.trim() : '';
  if (!imageUrl) {
    return <div className="admin-image-preview wide is-empty" aria-live="polite"><span>IMAGE PREVIEW</span><strong>이미지 URL을 입력하면 여기에 표시됩니다.</strong></div>;
  }
  return <figure className="admin-image-preview wide" role="img" aria-label={alt} style={{ backgroundImage: `url(${imageUrl})` }}><figcaption>현재 대표 이미지 미리보기</figcaption></figure>;
}

function ImageFilePicker({ label, multiple = false, disabled = false, onSelect }) {
  const inputRef = useRef(null);
  return <div className="image-file-picker wide">
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple={multiple} hidden onChange={(event) => {
      const files = [...(event.target.files || [])];
      event.target.value = '';
      if (files.length) void onSelect(files);
    }} />
    <button type="button" className="admin-image-upload" onClick={() => inputRef.current?.click()} disabled={disabled}>{disabled ? '이미지 저장 중…' : label}</button>
    <small>JPG · PNG · WebP · AVIF · GIF / 파일당 5MB</small>
  </div>;
}

function CabinImageGallery({ images, busy, onUpload, onSetPrimary, onRemove }) {
  return <section className="cabin-image-gallery wide" aria-label="객실 이미지 관리">
    <div className="cabin-image-gallery-heading"><div><span>ROOM GALLERY</span><strong>객실 이미지 {images.length}장</strong><small>첫 이미지는 대표 이미지로 자동 지정됩니다.</small></div><ImageFilePicker label="객실 이미지 추가" multiple disabled={busy} onSelect={onUpload} /></div>
    {images.length > 0 && <div className="cabin-image-grid">{images.map((image, index) => {
      const imageUrl = supabase.storage.from(image.storage_bucket).getPublicUrl(image.storage_path).data.publicUrl;
      return <figure key={image.id} className="cabin-gallery-image" role="img" aria-label={image.alt_text || `객실 이미지 ${index + 1}`} style={{ backgroundImage: `url(${imageUrl})` }}>
        <figcaption><span>{image.is_primary ? '대표 이미지' : `이미지 ${index + 1}`}</span><div>{!image.is_primary && <button type="button" onClick={() => onSetPrimary(image.id)} disabled={busy}>대표로 지정</button>}<button type="button" className="danger" onClick={() => onRemove(image.id)} disabled={busy}>삭제</button></div></figcaption>
      </figure>;
    })}</div>}
  </section>;
}

export default function AdminCruiseManager({ importOnly = false }) {
  const [session, setSession] = useState(undefined);
  const [operator, setOperator] = useState(null);
  const [data, setData] = useState(blankData);
  const [selectedId, setSelectedId] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [catalogService, setCatalogService] = useState('cruise');
  const [activePanel, setActivePanel] = useState(importOnly ? 'naver-import' : 'profile');
  const [catalogSection, setCatalogSection] = useState('product');
  const [expandedMenuGroups, setExpandedMenuGroups] = useState({ 'catalog-selection': false, 'catalog-management': false, cruise: true, system: false });
  const [selectedUnmatchedRate, setSelectedUnmatchedRate] = useState('');
  const [cruiseForm, setCruiseForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [cafeUrl, setCafeUrl] = useState(DEFAULT_CAFE_URL);
  const [cafePreview, setCafePreview] = useState(null);
  const [cafeBulkTarget, setCafeBulkTarget] = useState('');
  const [cafeImportToast, setCafeImportToast] = useState('');
  const cafeImageClickRef = useRef({ index: null, shiftKey: false });

  const adminRequest = useCallback(async (path, options = {}) => {
    const { data: authData } = await platformSupabase.auth.getSession();
    const token = authData.session?.access_token;
    if (!token) throw new Error('운영자 로그인이 필요합니다.');
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '관리자 요청에 실패했습니다.');
    return result;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await adminRequest('/api/admin/data');
      const next = result.data || blankData;
      setData(next);
      setOperator(result.operator || null);
      setSelectedId((current) => current || next.cruises[0]?.id || '');
      setSelectedCatalogId((current) => current || next.catalogProducts?.find((product) => product.service_type === catalogService)?.id || '');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [adminRequest, catalogService]);

  useEffect(() => {
    platformSupabase.auth.getSession().then(({ data: result }) => setSession(result.session));
    const { data: listener } = platformSupabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) void Promise.resolve().then(load); }, [session, load]);

  const selectedCruise = useMemo(() => data.cruises.find((cruise) => cruise.id === selectedId) || null, [data.cruises, selectedId]);
  const cabins = useMemo(() => data.cabins.filter((cabin) => cabin.cruise_id === selectedId), [data.cabins, selectedId]);
  const itineraries = useMemo(() => data.itineraries.filter((itinerary) => itinerary.cruise_id === selectedId), [data.itineraries, selectedId]);
  const cabinImagesByCabin = useMemo(() => {
    const images = new Map();
    for (const image of data.cabinImages || []) {
      const current = images.get(image.cabin_id) || [];
      current.push(image);
      images.set(image.cabin_id, current);
    }
    for (const current of images.values()) current.sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at));
    return images;
  }, [data.cabinImages]);
  const cabinById = useMemo(() => new Map(cabins.map((cabin) => [cabin.id, cabin])), [cabins]);
  const itineraryById = useMemo(() => new Map(itineraries.map((itinerary) => [itinerary.id, itinerary])), [itineraries]);
  const rates = useMemo(() => data.rates.filter((rate) => cabinById.has(rate.cabin_id)), [data.rates, cabinById]);
  const selectedTags = useMemo(() => data.tags.filter((tag) => tag.cruise_id === selectedId), [data.tags, selectedId]);
  const catalogProducts = useMemo(() => data.catalogProducts.filter((product) => product.service_type === catalogService), [data.catalogProducts, catalogService]);
  const selectedCatalogProduct = useMemo(() => catalogProducts.find((product) => product.id === selectedCatalogId) || null, [catalogProducts, selectedCatalogId]);
  const catalogPrices = useMemo(() => data.catalogPrices.filter((price) => price.product_id === selectedCatalogId), [data.catalogPrices, selectedCatalogId]);

  useEffect(() => { queueMicrotask(() => setCruiseForm(selectedCruise ? editableCruise(selectedCruise) : null)); }, [selectedCruise]);
  useEffect(() => {
    if (!cafeImportToast) return undefined;
    const timeoutId = window.setTimeout(() => setCafeImportToast(''), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [cafeImportToast]);

  async function save(label, action, id, values) {
    setSaving(label); setMessage(''); setError('');
    try {
      const result = await adminRequest('/api/admin/data', { method: 'PATCH', body: JSON.stringify({ action, id, values }) });
      setMessage('저장했습니다. 공개 화면에도 변경 사항이 반영됩니다.');
      await load();
      return result;
    } catch (saveError) {
      setError(saveError.message);
      return null;
    } finally {
      setSaving('');
    }
  }

  async function uploadImages(target, entityId, selectedFiles) {
    const files = [...(selectedFiles || [])];
    if (!files.length) return;
    const label = `image-upload-${target}-${entityId}`;
    setSaving(label); setMessage(''); setError('');
    try {
      for (const file of files) {
        const ticket = await adminRequest('/api/admin/images', {
          method: 'POST',
          body: JSON.stringify({ target, entityId, filename: file.name, contentType: file.type, size: file.size }),
        });
        const { error: uploadError } = await supabase.storage
          .from(ticket.upload.bucket)
          .uploadToSignedUrl(ticket.upload.path, ticket.upload.token, file, { contentType: file.type, cacheControl: '31536000' });
        if (uploadError) throw uploadError;
        await adminRequest('/api/admin/images', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'completeUpload', target, entityId, path: ticket.upload.path, altText: file.name }),
        });
      }
      setMessage(`${files.length}개 이미지를 Storage에 저장했습니다.`);
      await load();
    } catch (uploadError) {
      setError(uploadError.message || '이미지 저장에 실패했습니다.');
    } finally {
      setSaving('');
    }
  }

  async function changeCabinImage(action, imageId) {
    const label = `cabin-image-${action}-${imageId}`;
    setSaving(label); setMessage(''); setError('');
    try {
      await adminRequest('/api/admin/images', { method: 'PATCH', body: JSON.stringify({ action, imageId }) });
      setMessage(action === 'setCabinPrimaryImage' ? '대표 객실 이미지를 변경했습니다.' : '객실 이미지를 삭제했습니다.');
      await load();
    } catch (imageError) {
      setError(imageError.message || '객실 이미지를 변경하지 못했습니다.');
    } finally {
      setSaving('');
    }
  }

  async function previewCafeArticle() {
    setSaving('naver-preview'); setCafeImportToast(''); setMessage(''); setError('');
    try {
      const result = await adminRequest('/api/admin/naver-cafe-import', { method: 'POST', body: JSON.stringify({ action: 'preview', url: cafeUrl }) });
      const cruiseMatch = result.article.cruiseMatch || { status: 'unmatched' };
      if (cruiseMatch.status === 'matched') setSelectedId(cruiseMatch.cruise.id);
      if (cruiseMatch.status !== 'matched') setSelectedId('');
      setCafePreview({ ...result.article, cruiseMatch, cruiseConfirmed: cruiseMatch.status === 'matched', imageAssignments: result.article.images.map((image) => ({ sourceImageUrl: image.sourceUrl, imageName: image.generatedName, target: '', cabinId: '' })), selectedImageUrls: [], lastSelectedImageIndex: null, hiddenCabinIds: [] });
      setCafeBulkTarget('');
      setMessage(cruiseMatch.status === 'matched' ? `${cruiseMatch.cruise.nameKo}로 자동 분류했습니다. 저장 전 크루즈를 확인해 주세요.` : cruiseMatch.status === 'ambiguous' ? '일치하는 크루즈가 여러 개입니다. 저장할 크루즈를 목록에서 선택해 주세요.' : '일치하는 크루즈를 찾지 못했습니다. 저장할 크루즈를 목록에서 선택해 주세요.');
    } catch (importError) { setError(importError.message); } finally { setSaving(''); }
  }

  function resetCafeImport() {
    setCafeUrl('');
    setCafePreview(null);
    setCafeBulkTarget('');
    setCafeImportToast('');
    setMessage('');
    setError('');
  }

  async function saveCafeImageAssignments(preview, assignmentsToSave) {
    if (!preview.cruiseConfirmed || !selectedId) { setError('이미지를 저장할 크루즈를 자동 분류 결과로 확인하거나 목록에서 직접 선택해 주세요.'); return; }
    if (!assignmentsToSave.length) { setError('저장할 이미지를 선택한 뒤 저장 위치 또는 이미지 분류를 지정해 주세요.'); return; }
    if (assignmentsToSave.length !== preview.selectedImageUrls.length) { setError('선택한 이미지의 저장 대상 지정이 완료되지 않았습니다. 저장 위치를 다시 지정해 주세요.'); return; }
    setSaving('naver-import'); setMessage(''); setError('');
    try {
      const result = await adminRequest('/api/admin/naver-cafe-import', { method: 'POST', body: JSON.stringify({ action: 'import', url: cafeUrl, cruiseId: selectedId, imageAssignments: assignmentsToSave }) });
      const savedImageUrls = new Set(result.result.savedImageUrls || []);
      const savedCount = savedImageUrls.size;
      if (!savedCount) throw new Error(result.result.skippedImages?.[0]?.reason || '선택한 이미지를 저장하지 못했습니다. 다시 시도해 주세요.');
      const completionMessage = `이미지 ${savedCount}장 저장 완료${result.result.skippedImageCount ? ` · ${result.result.skippedImageCount}장 저장 실패` : ''}`;
      setMessage(completionMessage);
      setCafeImportToast(completionMessage);
      const completedCabins = assignmentsToSave.filter((item) => item.target === 'cabin' && savedImageUrls.has(item.sourceImageUrl)).map((item) => item.cabinId);
      setCafePreview({ ...preview, images: preview.images.filter((image) => !savedImageUrls.has(image.sourceUrl)), imageAssignments: preview.imageAssignments.filter((item) => !savedImageUrls.has(item.sourceImageUrl)), selectedImageUrls: [], lastSelectedImageIndex: null, hiddenCabinIds: [...new Set([...(preview.hiddenCabinIds || []), ...completedCabins])] });
      await load();
    } catch (importError) { setError(importError.message); } finally { setCafeBulkTarget(''); setSaving(''); }
  }

  function applyCafeImageTarget(value) {
    if (!cafePreview?.selectedImageUrls?.length) { setError('먼저 일괄 작업할 이미지를 선택해 주세요.'); return false; }
    const selected = new Set(cafePreview.selectedImageUrls);
    const [kind, cabinId = ''] = value.split(':');
    if (kind === 'delete') {
      setCafePreview({ ...cafePreview, images: cafePreview.images.filter((image) => !selected.has(image.sourceUrl)), imageAssignments: cafePreview.imageAssignments.filter((item) => !selected.has(item.sourceImageUrl)), selectedImageUrls: [], lastSelectedImageIndex: null });
      setMessage(`${selected.size}개 이미지를 가져오기 목록에서 삭제했습니다.`);
      setError('');
      return true;
    }
    if (kind === 'preset') {
      const preset = IMAGE_NAME_PRESETS.find((item) => item.value === cabinId);
      if (!preset) return false;
      const current = cafePreview.imageAssignments.filter((item) => !selected.has(item.sourceImageUrl));
      const counters = new Map();
      for (const item of current) {
        const matchedPreset = IMAGE_NAME_PRESETS.find((itemPreset) => item.imageName?.startsWith(`${itemPreset.value}-`));
        if (matchedPreset) counters.set(matchedPreset.value, (counters.get(matchedPreset.value) || 0) + 1);
      }
      const next = cafePreview.imageAssignments.map((item) => {
        if (!selected.has(item.sourceImageUrl)) return item;
        const serial = (counters.get(preset.value) || 0) + 1;
        counters.set(preset.value, serial);
        return { ...item, target: 'gallery', cabinId: '', imageName: `${preset.value}-${String(serial).padStart(3, '0')}` };
      });
      setCafePreview({ ...cafePreview, imageAssignments: next });
      setError('');
      return true;
    }
    const targetCabin = kind === 'cabin' ? cabins.find((cabin) => cabin.id === cabinId) : null;
    if (kind !== 'main' && !targetCabin) { setError('선택한 객실을 찾을 수 없습니다. 크루즈와 객실을 다시 확인해 주세요.'); return false; }
    if (targetCabin && !englishCabinName(targetCabin)) { setError('객실 이미지 파일명에 사용할 객실명이 없습니다. 객실명을 확인해 주세요.'); return false; }
    const current = cafePreview.imageAssignments.filter((item) => !selected.has(item.sourceImageUrl));
    const counters = new Map();
    for (const item of current) {
      const assignedCabin = item.target === 'cabin' ? cabins.find((cabin) => cabin.id === item.cabinId) : null;
      const base = item.target === 'hero' ? 'main' : item.target === 'cabin' ? fileStem(englishCabinName(assignedCabin)) : '';
      if (base) counters.set(base, (counters.get(base) || 0) + 1);
    }
    const next = cafePreview.imageAssignments.map((item) => {
      if (!selected.has(item.sourceImageUrl)) return item;
      const target = kind === 'main' ? 'hero' : 'cabin';
      const base = target === 'hero' ? 'main' : fileStem(englishCabinName(targetCabin));
      const serial = (counters.get(base) || 0) + 1;
      counters.set(base, serial);
      return { ...item, target, cabinId: target === 'cabin' ? cabinId : '', imageName: `${base}-${String(serial).padStart(3, '0')}` };
    });
    setCafePreview({ ...cafePreview, imageAssignments: next });
    setError('');
    return true;
  }

  function toggleCafeImageSelection(checked, index, shiftKey) {
    setCafePreview((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedImageUrls);
      const previousIndex = Number.isInteger(current.lastSelectedImageIndex) ? current.lastSelectedImageIndex : null;
      if (shiftKey && previousIndex !== null) {
        const start = Math.min(previousIndex, index);
        const end = Math.max(previousIndex, index);
        for (let itemIndex = start; itemIndex <= end; itemIndex += 1) {
          const sourceUrl = current.images[itemIndex]?.sourceUrl;
          if (sourceUrl) {
            if (checked) selected.add(sourceUrl);
            else selected.delete(sourceUrl);
          }
        }
      } else {
        const sourceUrl = current.images[index]?.sourceUrl;
        if (sourceUrl) {
          if (checked) selected.add(sourceUrl);
          else selected.delete(sourceUrl);
        }
      }
      return { ...current, selectedImageUrls: [...selected], lastSelectedImageIndex: index };
    });
  }

  function selectCruise(id) { setSelectedId(id); setMessage(''); setError(''); }
  function selectCatalogService(service) {
    setCatalogService(service);
    setSelectedCatalogId(data.catalogProducts.find((product) => product.service_type === service)?.id || '');
    setCatalogSection('product');
    setExpandedMenuGroups({ 'catalog-selection': true, 'catalog-management': true, cruise: false, system: false });
    setMessage(''); setError('');
  }
  function openAdminMenu(item, groupId) {
    if (item.catalogService) {
      setActivePanel('catalog');
      selectCatalogService(item.catalogService);
      return;
    }
    if (item.catalogSection) {
      setActivePanel('catalog');
      setCatalogSection(item.catalogSection);
      setExpandedMenuGroups({ 'catalog-selection': true, 'catalog-management': true, cruise: false, system: false });
      setMessage(''); setError('');
      return;
    }
    setExpandedMenuGroups({ 'catalog-selection': false, 'catalog-management': false, cruise: groupId === 'cruise', system: groupId === 'system' });
    setActivePanel(item.id);
    setMessage(''); setError('');
  }
  function toggleMenuGroup(groupId) {
    setExpandedMenuGroups((current) => {
      const isOpening = !current[groupId];
      if (groupId === 'catalog-selection') return { ...current, 'catalog-selection': isOpening, 'catalog-management': isOpening ? current['catalog-management'] : false };
      if (groupId === 'catalog-management') return { ...current, 'catalog-selection': true, 'catalog-management': isOpening, cruise: false, system: false };
      return { 'catalog-selection': false, 'catalog-management': false, cruise: groupId === 'cruise' && isOpening, system: groupId === 'system' && isOpening };
    });
  }
  function isMenuItemSelected(item) {
    if (item.catalogSection) return activePanel === 'catalog' && catalogSection === item.catalogSection;
    return item.catalogService
      ? activePanel === 'catalog' && catalogService === item.catalogService
      : activePanel === item.id;
  }

  async function addCruiseFromRateOnlySource() {
    const source = data.unmatchedRates.find((item) => item.legacy_name === selectedUnmatchedRate);
    if (!source) return;
    const result = await save('rate-only-cruise', 'createRateOnlyCruise', null, source);
    if (result?.result?.createdCruiseId) {
      setMessage('요금 테이블의 크루즈를 비공개 초안으로 추가했습니다. 기본 정보와 객실을 입력한 뒤 공개해 주세요.');
      setSelectedId(result.result.createdCruiseId);
      setSelectedUnmatchedRate('');
    }
  }

  if (session === undefined) return <div className="admin-state">관리자 권한을 확인하고 있습니다.</div>;
  if (!session) return <div className="admin-state"><p>이 페이지는 로그인한 운영자만 사용할 수 있습니다.</p><Link className="btn-primary" href="/login?next=/admin">운영자 로그인</Link></div>;

  const requiresCruiseSelection = !importOnly && !['catalog', 'members'].includes(activePanel);
  const activeCatalogManagementGroup = {
    id: 'catalog-management', label: `${CATALOG_SERVICE_LABELS[catalogService]} 관리`,
    items: [
      { id: 'catalog-product', label: '상품 기본 정보', catalogSection: 'product' },
      { id: 'catalog-prices', label: '상품 요금 관리', catalogSection: 'prices' },
    ],
  };
  const visibleMenuGroups = [
    CATALOG_SELECTION_GROUP,
    ...(activePanel === 'catalog' ? [activeCatalogManagementGroup] : [CRUISE_OPERATION_GROUP]),
    ...(operator?.role === 'admin' ? [SYSTEM_MENU_GROUP] : []),
  ];

  return <div className="admin-page">
    <header className="admin-masthead"><div className="container"><span>STAY HALONG / OPERATIONS{operator ? ` · ${operator.role.toUpperCase()}` : ''}</span><h1>{importOnly ? '데이터 가져오기' : '데이터 관리'}</h1><p>{importOnly ? '카페 게시물의 본문과 이미지를 검토한 뒤 홈페이지 데이터로 저장합니다.' : '크루즈 운영 정보와 플랫폼에서 가져온 홈페이지용 상품 데이터를 수정합니다.'}</p></div></header>
    <div className="admin-shell container">
      <aside className="admin-sidebar" aria-label="관리 메뉴">
        <span>ADMIN MENU</span>
        {importOnly ? <>
          <div className="admin-menu-group"><Link href="/admin" className="admin-menu-link"><i>01</i>데이터 관리</Link></div>
          <div className="admin-menu-group"><span className="admin-menu-link selected"><i>02</i>데이터 가져오기</span></div>
        </> : <>
        {visibleMenuGroups.map((group) => {
          const groupIsActive = group.items.some(isMenuItemSelected);
          const isExpanded = expandedMenuGroups[group.id];
          return <div className={`admin-menu-group${groupIsActive ? ' has-selected' : ''}`} key={group.id}>
            <button type="button" className="admin-menu-group-toggle" aria-expanded={isExpanded} aria-controls={`admin-menu-${group.id}`} onClick={() => toggleMenuGroup(group.id)}>
              <span>{group.label}</span><b aria-hidden="true">{isExpanded ? '−' : '+'}</b>
            </button>
            <div className="admin-menu-items" id={`admin-menu-${group.id}`} hidden={!isExpanded}>
              {group.items.map((item, index) => <button type="button" key={item.id} className={isMenuItemSelected(item) ? 'selected' : ''} onClick={() => openAdminMenu(item, group.id)}><i>{String(index + 1).padStart(2, '0')}</i>{item.label}</button>)}
            </div>
          </div>;
        })}
        <div className="admin-menu-group admin-import-menu"><span>콘텐츠 가져오기</span><Link href="/admin/naver-cafe-import" className="admin-menu-link"><i>01</i>데이터 가져오기</Link></div>
        </>}
      </aside>
      <main className="admin-content">
        {requiresCruiseSelection && <section className="cruise-select-panel" aria-label="수정할 크루즈 선택">
          <div><span>CRUISE DATA EDITOR</span><strong>수정할 크루즈를 선택하세요</strong><small>가나다순 · 총 {data.cruises.length}개</small></div>
          <label htmlFor="cruise-select" className="sr-only">크루즈 선택</label>
          <select id="cruise-select" value={selectedId} onChange={(event) => selectCruise(event.target.value)} disabled={loading || data.cruises.length === 0}>
            <option value="">크루즈를 선택하세요</option>
            {data.cruises.map((cruise) => <option key={cruise.id} value={cruise.id}>{cruise.name_ko}{cruise.name_en ? ` · ${cruise.name_en}` : ''}{cruise.is_active ? '' : ' (비공개)'}</option>)}
          </select>
        </section>}
        {error && <p className="admin-notice error">{error}</p>}{message && <p className="admin-notice success">{message}</p>}
        {loading ? <p className="admin-loading">데이터를 불러오는 중…</p> : ((requiresCruiseSelection && !selectedCruise) || (activePanel === 'catalog' && !selectedCatalogProduct)) ? <p className="admin-loading">표시할 관리 데이터가 없습니다.</p> : <div className="admin-workspace" data-active={activePanel}>
          {operator?.role === 'admin' && <section className="admin-section admin-panel" data-panel="members"><div className="admin-section-title"><span>07 / MEMBERS & ACCESS</span><h2>회원 및 권한 관리</h2><p>회원가입한 계정의 상태와 역할을 지정합니다.</p></div><div className="role-list">{data.roles.map((role) => <form key={role.id} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); save(`role-${role.id}`, 'updateMemberRole', role.id, { permissions: { manage_members: values.get('manage_members') === 'on', manage_cruises: values.get('manage_cruises') === 'on' } }); }}><div><strong>{role.label}</strong><small>{role.description}</small></div><label className="check"><input name="manage_members" type="checkbox" defaultChecked={Boolean(role.permissions?.manage_members)} /> 회원 관리</label><label className="check"><input name="manage_cruises" type="checkbox" defaultChecked={Boolean(role.permissions?.manage_cruises)} /> 크루즈 관리</label><button disabled={saving === `role-${role.id}`}>{saving === `role-${role.id}` ? '저장 중…' : '권한 저장'}</button></form>)}</div><div className="member-list">{data.members.map((member) => <form key={member.id} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); save(`member-${member.id}`, 'updateMember', member.id, { role_id: values.get('role_id'), status: values.get('status') }); }}><div><strong>{member.display_name || '이름 없음'}</strong><small>{member.email} · {member.phone || '연락처 없음'}</small></div><select name="role_id" defaultValue={member.role_id}>{data.roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select><select name="status" defaultValue={member.status}><option value="active">활성</option><option value="suspended">정지</option></select><button disabled={saving === `member-${member.id}`}>{saving === `member-${member.id}` ? '저장 중…' : '회원 저장'}</button></form>)}</div></section>}
          <section className="admin-section admin-panel" data-panel="profile"><div className="admin-section-title"><span>01 / CRUISE PROFILE</span><h2>기본 소개 및 공개 상태</h2><a href={selectedCruise?.slug ? `/product/${encodeURIComponent(selectedCruise.slug)}` : '#'} target="_blank" rel="noreferrer">공개 화면 보기 ↗</a></div>
            <div className="rate-only-source"><div><span>RATE TABLE ONLY</span><strong>인포 테이블에 없는 요금 크루즈</strong><p>선택하면 비공개 초안과 일정이 생성됩니다. 객실과 설명을 추가한 뒤 공개하세요.</p></div><div><select value={selectedUnmatchedRate} onChange={(event) => setSelectedUnmatchedRate(event.target.value)}><option value="">요금 전용 크루즈 선택 ({data.unmatchedRates.length})</option>{data.unmatchedRates.map((source) => <option value={source.legacy_name} key={source.legacy_name}>{source.legacy_name} · 요금 {source.rate_count}건 · {(source.schedule_types || []).join(', ')}</option>)}</select><button type="button" className="admin-save" onClick={addCruiseFromRateOnlySource} disabled={!selectedUnmatchedRate || saving === 'rate-only-cruise'}>{saving === 'rate-only-cruise' ? '추가 중…' : '관리 크루즈로 추가 →'}</button></div></div>
            <form onSubmit={(event) => { event.preventDefault(); save('cruise', 'updateCruise', selectedId, { ...cruiseForm, star_rating: numeric(cruiseForm.star_rating) }); }} className="admin-form profile-form">
              <label>국문 상품명<input value={cruiseForm?.name_ko || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, name_ko: event.target.value })} required /></label><label>영문 상품명<input value={cruiseForm?.name_en || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, name_en: event.target.value })} /></label><label>카테고리<input value={cruiseForm?.category || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, category: event.target.value })} /></label><label>별점 (0–5)<input type="number" min="0" max="5" step="0.1" value={cruiseForm?.star_rating || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, star_rating: event.target.value })} /></label><label className="wide">대표 이미지 경로 또는 URL<input value={cruiseForm?.hero_image || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, hero_image: event.target.value })} placeholder="https:// 또는 /images/cruises/..." /></label><ImageFilePicker label="대표 이미지 선택" disabled={saving === `image-upload-cruise-hero-${selectedId}`} onSelect={(files) => uploadImages('cruise-hero', selectedId, files)} /><ImagePreview src={cruiseForm?.hero_image} alt={`${cruiseForm?.name_ko || '크루즈'} 대표 이미지`} /><label className="wide">상품 설명<textarea rows="5" value={cruiseForm?.description || ''} onChange={(event) => setCruiseForm({ ...cruiseForm, description: event.target.value })} /></label><label className="check wide"><input type="checkbox" checked={Boolean(cruiseForm?.is_active)} onChange={(event) => setCruiseForm({ ...cruiseForm, is_active: event.target.checked })} /> 공개 상품으로 노출</label><button className="admin-save wide" disabled={saving === 'cruise'}>{saving === 'cruise' ? '저장 중…' : '기본 정보 저장 →'}</button></form>
          </section>
          <section className="admin-section admin-panel" data-panel="naver-import">
            <div className="admin-section-title"><span>CAFE IMPORT</span><h2>데이터 가져오기</h2><p>본문과 사진을 검토한 뒤, 확인한 데이터만 저장합니다.</p></div>
            <div className="cafe-import-panel"><label>게시물 URL<input value={cafeUrl} onChange={(event) => { setCafeUrl(event.target.value); setCafePreview(null); }} /></label><div className="cafe-import-actions"><button type="button" className="admin-delete" onClick={resetCafeImport} disabled={saving !== ''}>초기화</button><button type="button" className="admin-save" onClick={previewCafeArticle} disabled={saving === 'naver-preview' || !cafeUrl.trim()}>{saving === 'naver-preview' ? '불러오는 중…' : '미리보기 →'}</button></div></div>
            {cafePreview && <div className="cafe-import-preview">
              {cafeImportToast && <div className="cafe-import-toast" role="status" aria-live="polite">{cafeImportToast}</div>}
              <div><span>IMAGE PREVIEW</span><strong>{cafePreview.title}</strong><small>저장할 이미지를 선택하고 대표 이미지 또는 객실 이미지로 지정하세요.</small></div>
              <section className={`cafe-import-cruise-match ${cafePreview.cruiseMatch?.status || 'unmatched'}`} aria-label="저장할 크루즈 확인">
                <div><span>{cafePreview.cruiseMatch?.status === 'matched' ? 'AUTO MATCHED' : cafePreview.cruiseMatch?.status === 'manual' ? 'MANUALLY SELECTED' : 'CONFIRM CRUISE'}</span><strong>{cafePreview.cruiseMatch?.status === 'matched' ? `${cafePreview.cruiseMatch.cruise.nameKo} 자동 분류` : cafePreview.cruiseMatch?.status === 'manual' ? `${data.cruises.find((cruise) => cruise.id === selectedId)?.name_ko || '크루즈'} 관리자 선택` : cafePreview.cruiseMatch?.status === 'ambiguous' ? '크루즈 자동 분류 보류' : '크루즈를 선택해 주세요'}</strong><small>{cafePreview.cruiseMatch?.status === 'matched' ? `제목의 “${cafePreview.cruiseMatch.matchedName}”과 정확히 일치했습니다.` : cafePreview.cruiseMatch?.status === 'manual' ? '관리자가 선택한 크루즈로 이미지를 저장합니다.' : '자동 분류 결과와 관계없이 저장할 크루즈를 직접 선택해야 합니다.'}</small></div>
                <label>저장할 크루즈<select value={selectedId} onChange={(event) => { const cruiseId = event.target.value; setSelectedId(cruiseId); setCafePreview({ ...cafePreview, cruiseMatch: { ...cafePreview.cruiseMatch, status: cruiseId ? 'manual' : 'unmatched' }, cruiseConfirmed: Boolean(cruiseId) }); setError(''); }}><option value="">저장할 크루즈를 선택하세요</option>{data.cruises.map((cruise) => <option key={cruise.id} value={cruise.id}>{cruise.name_ko}{cruise.name_en ? ` · ${cruise.name_en}` : ''}</option>)}</select></label>
              </section>
              <div className="cafe-import-image-heading"><strong>저장/추출 대상 {cafePreview.imageAssignments.filter((item) => item.target && item.target !== 'delete').length} / {cafePreview.imageCount}장</strong><small>이미지를 체크하세요. 첫 이미지 선택 후 Shift+클릭하면 연속 선택됩니다.</small></div>
              <div className="cafe-import-bulk cafe-import-bulk-sticky"><label className="check"><input type="checkbox" checked={cafePreview.selectedImageUrls.length === cafePreview.images.length && cafePreview.images.length > 0} onChange={(event) => setCafePreview({ ...cafePreview, selectedImageUrls: event.target.checked ? cafePreview.images.map((image) => image.sourceUrl) : [], lastSelectedImageIndex: null })} /> 전체 선택</label><select value={cafeBulkTarget} disabled={saving === 'naver-import'} onChange={(event) => { const target = event.target.value; setCafeBulkTarget(target && applyCafeImageTarget(target) ? target : ''); }}><option value="" disabled>선택 이미지 지정</option><option value="main">대표 이미지로 지정</option>{IMAGE_NAME_PRESETS.map((item) => <option value={`preset:${item.value}`} key={item.value}>{item.label} 이미지명 지정</option>)}{cabins.filter((cabin) => !(cafePreview.hiddenCabinIds || []).includes(cabin.id)).map((cabin) => { const englishName = englishCabinName(cabin); return <option value={`cabin:${cabin.id}`} key={cabin.id} disabled={!englishName}>{englishName ? `${englishName} 객실 이미지로 지정` : `${cabin.name_ko || '객실'} · 객실명 입력 필요`}</option>; })}</select><button type="button" className="admin-save" disabled={saving === 'naver-import' || !cafeBulkTarget || !cafePreview.selectedImageUrls.length} onClick={() => { const selected = new Set(cafePreview.selectedImageUrls); void saveCafeImageAssignments(cafePreview, cafePreview.imageAssignments.filter((item) => selected.has(item.sourceImageUrl) && ['hero', 'cabin', 'gallery'].includes(item.target))); }}>{saving === 'naver-import' ? '이미지 저장 중…' : '선택 이미지 저장'}</button><button type="button" className="admin-delete" disabled={saving === 'naver-import' || !cafePreview.selectedImageUrls.length} onClick={() => { applyCafeImageTarget('delete'); setCafeBulkTarget(''); }}>선택 이미지 삭제</button></div>
              {cafePreview.images.length > 0 && <div className="cafe-import-images">{cafePreview.images.map((image, index) => { const assignment = cafePreview.imageAssignments[index]; return <label id={`cafe-import-image-${index}`} key={image.sourceUrl}><input type="checkbox" checked={cafePreview.selectedImageUrls.includes(image.sourceUrl)} onClick={(event) => { cafeImageClickRef.current = { index, shiftKey: event.shiftKey }; }} onChange={(event) => { const click = cafeImageClickRef.current; toggleCafeImageSelection(event.target.checked, index, click.index === index && click.shiftKey); }} /><figure role="img" aria-label={assignment.imageName} style={{ backgroundImage: `url(${image.previewUrl})` }} /><span>{assignment.imageName}</span></label>; })}</div>}
            </div>}
          </section>
          <section className="admin-section admin-panel" data-panel="tags"><div className="admin-section-title"><span>02 / RECOMMENDATION RULES</span><h2>추천 기준 태그</h2><p>태그별 근거를 직접 관리합니다.</p></div><div className="tag-manager">{TAGS.map((tag) => { const row = selectedTags.find((item) => item.tag === tag); return <form key={tag} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); save(`tag-${tag}`, 'upsertCruiseTag', selectedId, { tag, evidence: values.get('evidence'), is_active: values.get('is_active') === 'on' }); }}><strong>#{tag}</strong><input name="evidence" defaultValue={row?.evidence || ''} placeholder="추천 근거를 입력하세요" required /><label className="check"><input name="is_active" type="checkbox" defaultChecked={Boolean(row?.is_active)} /> 추천에 사용</label><button disabled={saving === `tag-${tag}`}>저장</button></form>; })}</div></section>
          <section className="admin-section admin-panel" data-panel="itinerary"><div className="admin-section-title"><span>03 / ITINERARY</span><h2>일정 공개 및 설명</h2></div><div className="editor-list">{itineraries.map((itinerary) => <form key={itinerary.id} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); save(`itinerary-${itinerary.id}`, 'updateItinerary', itinerary.id, { description: values.get('description'), is_active: values.get('is_active') === 'on' }); }}><b>{SCHEDULE_LABELS[itinerary.schedule_type]}</b><input name="description" defaultValue={itinerary.description || ''} placeholder="일정 설명" /><label className="check"><input name="is_active" type="checkbox" defaultChecked={itinerary.is_active} /> 공개</label><button>저장</button></form>)}</div></section>
          <section className="admin-section admin-panel" data-panel="cabins"><div className="admin-section-title"><span>04 / CABINS</span><h2>객실 정보</h2><p>객실의 특징은 추천 태그와 고객 안내에 사용됩니다.</p></div><div className="cabin-editor">{cabins.map((cabin) => <CabinForm key={cabin.id} cabin={cabin} images={cabinImagesByCabin.get(cabin.id) || []} saving={saving === `cabin-${cabin.id}`} imageBusy={saving === `image-upload-cabin-gallery-${cabin.id}` || saving.startsWith('cabin-image-')} onSave={(values) => save(`cabin-${cabin.id}`, 'updateCabin', cabin.id, values)} onUpload={(files) => uploadImages('cabin-gallery', cabin.id, files)} onSetPrimary={(imageId) => changeCabinImage('setCabinPrimaryImage', imageId)} onRemove={(imageId) => changeCabinImage('removeCabinImage', imageId)} />)}</div></section>
          <section className="admin-section admin-panel" data-panel="rates"><div className="admin-section-title"><span>05 / RATES</span><h2>등록 요금 및 적용 기간</h2><p>금액은 VND 기준이며, 공개 여부를 끄면 고객 화면에서 제외됩니다.</p></div><div className="rate-editor">{rates.map((rate) => <RateForm key={rate.id} rate={rate} cabin={cabinById.get(rate.cabin_id)} itinerary={itineraryById.get(rate.itinerary_id)} saving={saving === `rate-${rate.id}`} onSave={(values) => save(`rate-${rate.id}`, 'updateRate', rate.id, values)} />)}</div></section>
          <section className="admin-section admin-panel" data-panel="catalog">
            <div className="admin-section-title"><span>06 / HOMEPAGE CATALOG</span><h2>{CATALOG_SERVICE_LABELS[catalogService]} 홈페이지 상품 관리</h2><p>플랫폼 원본은 읽기 전용입니다. 이 화면에서 저장한 홈페이지용 표현과 요금은 다음 동기화 후에도 유지됩니다.</p></div>
            <div className="catalog-select-panel">
              <label>서비스<select value={catalogService} onChange={(event) => selectCatalogService(event.target.value)}>{[['cruise', '크루즈'], ['hotel', '호텔'], ['tour', '투어'], ['vehicle', '차량'], ['airport', '공항']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>수정할 상품<select value={selectedCatalogId} onChange={(event) => setSelectedCatalogId(event.target.value)}><option value="">상품을 선택하세요</option>{catalogProducts.map((product) => <option key={product.id} value={product.id}>{product.name_ko}{product.is_active ? '' : ' (비공개)'}</option>)}</select></label>
            </div>
            {selectedCatalogProduct && <>{catalogSection === 'product' && <CatalogProductForm product={selectedCatalogProduct} saving={saving === `catalog-product-${selectedCatalogProduct.id}`} imageBusy={saving === `image-upload-catalog-hero-${selectedCatalogProduct.id}`} onSave={(values) => save(`catalog-product-${selectedCatalogProduct.id}`, 'updateCatalogProduct', selectedCatalogProduct.id, values)} onUpload={(files) => uploadImages('catalog-hero', selectedCatalogProduct.id, files)} />}
              {catalogSection === 'prices' && <><div className="catalog-price-heading"><span>PRICE DATA</span><strong>상품 요금 {catalogPrices.length}건</strong></div>
                <div className="rate-editor">{catalogPrices.map((price) => <CatalogPriceForm key={price.id} price={price} saving={saving === `catalog-price-${price.id}`} onSave={(values) => save(`catalog-price-${price.id}`, 'updateCatalogPrice', price.id, values)} />)}</div>
              </>}
            </>}
          </section>
        </div>}
      </main>
    </div>
  </div>;
}

function CabinForm({ cabin, images, onSave, onUpload, onSetPrimary, onRemove, saving, imageBusy }) {
  const [form, setForm] = useState(cabin);
  useEffect(() => { queueMicrotask(() => setForm(cabin)); }, [cabin]);
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ name_ko: form.name_ko, name_en: form.name_en || null, image_url: form.image_url || null, room_area_text: form.room_area_text || null, bed_type: form.bed_type || null, max_adults: numeric(form.max_adults), max_guests: numeric(form.max_guests), has_balcony: form.has_balcony, is_vip: form.is_vip, has_butler: form.has_butler, is_recommended: form.is_recommended, connecting_available: form.connecting_available, extra_bed_available: form.extra_bed_available, facilities: form.facilities || null, special_amenities: form.special_amenities || null, is_active: form.is_active }); }}>
    <header><b>{cabin.name_ko}</b><label className="check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> 공개</label></header>
    <div className="cabin-grid">
      <label>객실명<input value={form.name_ko} onChange={(event) => setForm({ ...form, name_ko: event.target.value })} required /></label>
      <label>영문명<input value={form.name_en || ''} onChange={(event) => setForm({ ...form, name_en: event.target.value })} /></label>
      <label>최대 성인<input type="number" min="1" value={form.max_adults} onChange={(event) => setForm({ ...form, max_adults: event.target.value })} /></label>
      <label>최대 인원<input type="number" min="1" value={form.max_guests} onChange={(event) => setForm({ ...form, max_guests: event.target.value })} /></label>
      <label>면적<input value={form.room_area_text || ''} onChange={(event) => setForm({ ...form, room_area_text: event.target.value })} /></label>
      <label>침대<input value={form.bed_type || ''} onChange={(event) => setForm({ ...form, bed_type: event.target.value })} /></label>
      <label className="wide">객실 이미지 URL<input value={form.image_url || ''} onChange={(event) => setForm({ ...form, image_url: event.target.value })} placeholder="https:// 또는 /images/cabins/..." /></label>
      <ImagePreview src={form.image_url} alt={`${form.name_ko || '객실'} 대표 이미지`} />
      <CabinImageGallery images={images} busy={imageBusy} onUpload={onUpload} onSetPrimary={onSetPrimary} onRemove={onRemove} />
      <label className="wide">시설<textarea rows="2" value={form.facilities || ''} onChange={(event) => setForm({ ...form, facilities: event.target.value })} /></label>
      <label className="wide">특별 어메니티<textarea rows="2" value={form.special_amenities || ''} onChange={(event) => setForm({ ...form, special_amenities: event.target.value })} /></label>
    </div>
    <div className="feature-checks">{[['has_balcony','발코니'],['is_vip','VIP'],['has_butler','버틀러'],['is_recommended','추천 객실'],['connecting_available','커넥팅'],['extra_bed_available','엑스트라베드']].map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /> {label}</label>)}</div>
    <button className="admin-save" disabled={saving}>{saving ? '저장 중…' : '객실 저장 →'}</button>
  </form>;
}

function RateForm({ rate, cabin, itinerary, onSave, saving }) {
  const [form, setForm] = useState({ ...rate, valid_from: String(rate.valid_during).match(/\d{4}-\d{2}-\d{2}/)?.[0] || '', valid_to: [...String(rate.valid_during).matchAll(/\d{4}-\d{2}-\d{2}/g)].at(-1)?.[0] || '' });
  useEffect(() => { const dates = [...String(rate.valid_during).matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]); queueMicrotask(() => setForm({ ...rate, valid_from: dates[0] || '', valid_to: dates[1] || '' })); }, [rate]);
  return <form onSubmit={(event) => { event.preventDefault(); const valid_during = dateRange(form.valid_from, form.valid_to); if (!valid_during) return; onSave({ valid_during, price_basis: form.price_basis, price_adult: numeric(form.price_adult), price_child: numeric(form.price_child), price_infant: numeric(form.price_infant), price_single: numeric(form.price_single), price_extra_bed: numeric(form.price_extra_bed), season_name: form.season_name || null, single_available: form.single_available, extra_bed_available: form.extra_bed_available, is_active: form.is_active }); }}><header><b>{cabin?.name_ko || '객실 정보 없음'} / {SCHEDULE_LABELS[itinerary?.schedule_type] || '일정 정보 없음'}</b><label className="check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> 공개</label></header><div className="rate-grid"><label>적용 시작<input type="date" value={form.valid_from} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} required /></label><label>적용 종료<input type="date" value={form.valid_to} onChange={(event) => setForm({ ...form, valid_to: event.target.value })} required /></label><label>가격 단위<select value={form.price_basis} onChange={(event) => setForm({ ...form, price_basis: event.target.value })}>{['unknown','per_cabin','per_adult','per_person'].map((basis) => <option value={basis} key={basis}>{basis}</option>)}</select></label><label>시즌<input value={form.season_name || ''} onChange={(event) => setForm({ ...form, season_name: event.target.value })} /></label>{[['price_adult','성인'],['price_child','아동'],['price_infant','유아'],['price_single','싱글'],['price_extra_bed','엑스트라베드']].map(([key, label]) => <label key={key}>{label} (VND)<input type="number" min="0" value={form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div><div className="feature-checks"><label className="check"><input type="checkbox" checked={form.single_available} onChange={(event) => setForm({ ...form, single_available: event.target.checked })} /> 싱글 가능</label><label className="check"><input type="checkbox" checked={form.extra_bed_available} onChange={(event) => setForm({ ...form, extra_bed_available: event.target.checked })} /> 엑스트라베드 가능</label></div><button className="admin-save" disabled={saving}>{saving ? '저장 중…' : '요금 저장 →'}</button></form>;
}

function CatalogProductForm({ product, onSave, onUpload, saving, imageBusy }) {
  const [form, setForm] = useState(product);
  useEffect(() => { queueMicrotask(() => setForm(product)); }, [product]);
  return <form className="admin-form catalog-product-form" onSubmit={(event) => { event.preventDefault(); onSave({ name_ko: form.name_ko, description: form.description || '', category: form.category || '', image_url: form.image_url || '', is_active: Boolean(form.is_active) }); }}>
    <div className="catalog-source wide"><span>PLATFORM SOURCE</span><strong>{product.source} · {product.source_key}</strong><small>마지막 원본 반영 {product.source_updated_at ? new Date(product.source_updated_at).toLocaleString('ko-KR') : '정보 없음'}</small></div>
    <label>상품명<input value={form.name_ko || ''} onChange={(event) => setForm({ ...form, name_ko: event.target.value })} required /></label>
    <label>카테고리<input value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
    <label className="wide">대표 이미지 URL<input value={form.image_url || ''} onChange={(event) => setForm({ ...form, image_url: event.target.value })} placeholder="https:// 또는 /images/..." /></label>
    <ImageFilePicker label="대표 이미지 선택" disabled={imageBusy} onSelect={onUpload} />
    <ImagePreview src={form.image_url} alt={`${form.name_ko || '상품'} 대표 이미지`} />
    <label className="wide">홈페이지 상품 설명<textarea rows="5" value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
    <label className="check wide"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> 홈페이지에 공개</label>
    <button className="admin-save wide" disabled={saving}>{saving ? '저장 중…' : '홈페이지 상품 저장 →'}</button>
  </form>;
}

function CatalogPriceForm({ price, onSave, saving }) {
  const [form, setForm] = useState({ ...price, valid_from: price.valid_from || '', valid_to: price.valid_to || '' });
  useEffect(() => { queueMicrotask(() => setForm({ ...price, valid_from: price.valid_from || '', valid_to: price.valid_to || '' })); }, [price]);
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ label: form.label || '', price_amount: numeric(form.price_amount), currency: form.currency || 'VND', price_unit: form.price_unit, min_guests: numeric(form.min_guests), max_guests: numeric(form.max_guests), valid_from: form.valid_from, valid_to: form.valid_to, is_active: Boolean(form.is_active) }); }}><header><b>{form.label || '요금 이름 없음'}</b><label className="check"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> 홈페이지 공개</label></header><div className="rate-grid"><label>요금명<input value={form.label || ''} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label><label>금액<input type="number" min="0" value={form.price_amount ?? ''} onChange={(event) => setForm({ ...form, price_amount: event.target.value })} /></label><label>통화<input value={form.currency || 'VND'} maxLength="3" onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label><label>요금 단위<select value={form.price_unit} onChange={(event) => setForm({ ...form, price_unit: event.target.value })}>{[['per_adult', '성인 1인'], ['per_person', '1인'], ['per_room', '객실'], ['per_vehicle', '차량'], ['unknown', '확인 필요']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>최소 인원<input type="number" min="1" value={form.min_guests ?? ''} onChange={(event) => setForm({ ...form, min_guests: event.target.value })} /></label><label>최대 인원<input type="number" min="1" value={form.max_guests ?? ''} onChange={(event) => setForm({ ...form, max_guests: event.target.value })} /></label><label>적용 시작<input type="date" value={form.valid_from || ''} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} /></label><label>적용 종료<input type="date" value={form.valid_to || ''} onChange={(event) => setForm({ ...form, valid_to: event.target.value })} /></label></div><button className="admin-save" disabled={saving}>{saving ? '저장 중…' : '홈페이지 요금 저장 →'}</button></form>;
}
