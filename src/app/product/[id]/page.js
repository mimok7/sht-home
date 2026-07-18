'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import CruiseMediaGallery from '@/components/CruiseMediaGallery';
import './product.css';

const PRODUCT_COLUMNS = 'cruise_id,slug,cruise_name,cruise_name_en,description,category,star_rating,hero_image,itinerary_id,schedule_type,nights,cabin_id,cabin_name,cabin_name_en,cabin_image,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,rate_plan_id,valid_from,valid_to,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,tags';
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };
const SCHEDULE_ORDER = ['DAY', '1N2D', '2N3D'];
const MEDIA_CATEGORY_LABELS = {
  main: { label: '대표 이미지', eyebrow: 'CRUISE' },
  exterior: { label: '익스테리어', eyebrow: 'EXTERIOR' },
  interior: { label: '인테리어', eyebrow: 'INTERIOR' },
  menu: { label: '메뉴', eyebrow: 'MENU' },
};

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatVnd(value, currency = 'VND') {
  const price = positiveNumber(value);
  return price ? `${price.toLocaleString('ko-KR')} ${currency}` : '상담 확인';
}

function rateMatchesDate(rate, date) {
  if (!date) return true;
  return (!rate.valid_from || rate.valid_from <= date) && (!rate.valid_to || rate.valid_to >= date);
}

function chooseRate(cabin, scheduleType, date) {
  const scheduled = cabin?.rates.filter((rate) => rate.schedule_type === scheduleType) || [];
  const dated = scheduled.filter((rate) => rateMatchesDate(rate, date));
  const candidates = date ? dated : scheduled;
  return [...candidates].sort((left, right) => {
    const leftPrice = positiveNumber(left.price_adult) ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = positiveNumber(right.price_adult) ?? Number.MAX_SAFE_INTEGER;
    return leftPrice - rightPrice;
  })[0] || null;
}

function buildCabins(rows) {
  const cabins = new Map();
  for (const row of rows) {
    if (!row.cabin_id) continue;
    if (!cabins.has(row.cabin_id)) {
      cabins.set(row.cabin_id, {
        id: row.cabin_id,
        name: row.cabin_name,
        nameEn: row.cabin_name_en,
        imageUrl: row.cabin_image,
        roomArea: row.room_area_text,
        bedType: row.bed_type,
        maxAdults: row.max_adults,
        maxGuests: row.max_guests,
        hasBalcony: row.has_balcony,
        isVip: row.is_vip,
        hasButler: row.has_butler,
        isRecommended: row.is_recommended,
        connectingAvailable: row.connecting_available,
        extraBedAvailable: row.extra_bed_available,
        facilities: row.facilities,
        specialAmenities: row.special_amenities,
        rates: [],
      });
    }
    cabins.get(row.cabin_id).rates.push(row);
  }
  return [...cabins.values()].sort((left, right) => Number(right.isRecommended) - Number(left.isRecommended) || left.name.localeCompare(right.name, 'ko'));
}

function sortMediaImages(left, right) {
  return Number(right.isPrimary) - Number(left.isPrimary)
    || Number(left.sortOrder) - Number(right.sortOrder)
    || String(left.name).localeCompare(String(right.name), undefined, { numeric: true });
}

function publicStorageUrl(bucket, path) {
  if (!bucket || !path) return '';
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function buildMediaGroups(importRows, cabinImageRows, cabins) {
  const groups = new Map();
  const cabinById = new Map(cabins.map((cabin) => [cabin.id, cabin]));

  function addImage(group, image) {
    if (!image.url) return;
    if (!groups.has(group.id)) groups.set(group.id, { ...group, images: [] });
    const images = groups.get(group.id).images;
    if (!images.some((current) => current.url === image.url)) images.push(image);
  }

  for (const row of importRows || []) {
    if (row.cabin_id) continue;
    const filename = row.image_name || row.storage_path?.split('/').pop() || '';
    const category = String(filename).match(/^(main|exterior|interior|menu)-/i)?.[1]?.toLowerCase();
    if (!category || !MEDIA_CATEGORY_LABELS[category]) continue;
    const label = MEDIA_CATEGORY_LABELS[category];
    addImage(
      { id: category, ...label },
      {
        id: row.id,
        url: publicStorageUrl(row.storage_bucket, row.storage_path),
        alt: `${label.label} ${filename}`,
        name: filename,
        sortOrder: row.sort_order,
        isPrimary: false,
      }
    );
  }

  for (const row of cabinImageRows || []) {
    const cabin = cabinById.get(row.cabin_id);
    if (!cabin) continue;
    const label = cabin.nameEn || cabin.name || '객실';
    addImage(
      { id: `cabin-${cabin.id}`, label, eyebrow: 'CABIN' },
      {
        id: row.id,
        url: publicStorageUrl(row.storage_bucket, row.storage_path),
        alt: row.alt_text || `${label} 객실 이미지`,
        name: row.storage_path,
        sortOrder: row.sort_order,
        isPrimary: row.is_primary,
      }
    );
  }

  const groupOrder = new Map([
    ['main', 0],
    ['exterior', 1],
    ['interior', 2],
    ['menu', 3],
    ...cabins.map((cabin, index) => [`cabin-${cabin.id}`, index + 4]),
  ]);

  return [...groups.values()]
    .map((group) => ({ ...group, images: group.images.sort(sortMediaImages) }))
    .sort((left, right) => (groupOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

function parseFacilities(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    // Legacy free text was preserved in v2; split it conservatively for display.
  }
  return String(value).split(/\\n|\n|,|·/).map((item) => item.trim()).filter(Boolean);
}

function cabinFeatures(cabin) {
  return [
    cabin.maxGuests ? `최대 ${cabin.maxGuests}명` : null,
    cabin.hasBalcony ? '발코니' : null,
    cabin.isVip ? 'VIP' : null,
    cabin.hasButler ? '버틀러' : null,
    cabin.connectingAvailable ? '커넥팅 가능' : null,
    cabin.extraBedAvailable ? '엑스트라베드 가능' : null,
  ].filter(Boolean);
}

export default function ProductDetail({ params }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cruise, setCruise] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [mediaGroups, setMediaGroups] = useState([]);
  const [selectedCabinId, setSelectedCabinId] = useState(null);
  const [detailCabinId, setDetailCabinId] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState('');
  const [date, setDate] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchProduct() {
      setLoading(true);
      setLoadError('');
      setMediaGroups([]);
      const decodedId = decodeURIComponent(id);
      let result = await supabase
        .from('public_cruise_recommendation_v2')
        .select(PRODUCT_COLUMNS)
        .eq('slug', decodedId);

      if (!result.error && !result.data?.length) {
        result = await supabase
          .from('public_cruise_recommendation_v2')
          .select(PRODUCT_COLUMNS)
          .eq('cruise_name', decodedId);
      }

      if (cancelled) return;
      if (result.error) {
        setLoadError('v2 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        setLoading(false);
        return;
      }
      if (!result.data?.length) {
        setLoadError('현재 공개된 v2 상품을 찾을 수 없습니다.');
        setLoading(false);
        return;
      }

      const rows = result.data;
      const first = rows[0];
      const schedules = [...new Set(rows.map((row) => row.schedule_type))]
        .sort((left, right) => SCHEDULE_ORDER.indexOf(left) - SCHEDULE_ORDER.indexOf(right));
      const nextCabins = buildCabins(rows);
      const cabinIds = nextCabins.map((cabin) => cabin.id);
      const [importsResult, cabinImagesResult] = await Promise.all([
        supabase
          .from('cruise_cafe_import_images_v2')
          .select('id,cabin_id,image_name,storage_bucket,storage_path,sort_order,created_at')
          .eq('cruise_id', first.cruise_id)
          .order('created_at')
          .order('sort_order'),
        cabinIds.length
          ? supabase
            .from('cabin_images_v2')
            .select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at')
            .in('cabin_id', cabinIds)
            .order('sort_order')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (cancelled) return;
      if (importsResult.error || cabinImagesResult.error) {
        console.error('Failed to load public cruise gallery:', importsResult.error?.message || cabinImagesResult.error?.message);
      }
      setCruise({
        id: first.cruise_id,
        slug: first.slug,
        name: first.cruise_name,
        nameEn: first.cruise_name_en,
        description: first.description,
        category: first.category,
        rating: first.star_rating,
        heroImage: first.hero_image,
        tags: first.tags || [],
        schedules,
      });
      setCabins(nextCabins);
      setMediaGroups(buildMediaGroups(importsResult.data || [], cabinImagesResult.data || [], nextCabins));
      setSelectedSchedule(schedules[0] || '');
      setSelectedCabinId(nextCabins.find((cabin) => cabin.rates.some((rate) => rate.schedule_type === schedules[0]))?.id || nextCabins[0]?.id || null);
      setLoading(false);
    }

    fetchProduct();
    return () => { cancelled = true; };
  }, [id]);

  const availableCabins = useMemo(
    () => cabins.filter((cabin) => cabin.rates.some((rate) => rate.schedule_type === selectedSchedule)),
    [cabins, selectedSchedule]
  );
  const selectedCabin = availableCabins.find((cabin) => cabin.id === selectedCabinId) || availableCabins[0] || null;
  const selectedRate = useMemo(
    () => chooseRate(selectedCabin, selectedSchedule, date),
    [selectedCabin, selectedSchedule, date]
  );
  const detailCabin = cabins.find((cabin) => cabin.id === detailCabinId) || null;
  const detailRate = chooseRate(detailCabin, selectedSchedule, date);
  const detailFacilities = parseFacilities(detailCabin?.facilities);
  const archiveGroups = mediaGroups.filter((group) => !group.id.startsWith('cabin-'));
  const cabinMediaById = new Map(
    mediaGroups
      .filter((group) => group.id.startsWith('cabin-'))
      .map((group) => [group.id.slice('cabin-'.length), group])
  );

  useEffect(() => {
    if (!detailCabin) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDetailCabinId(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailCabin]);

  function handleScheduleChange(event) {
    const scheduleType = event.target.value;
    setSelectedSchedule(scheduleType);
    setSelectedCabinId(cabins.find((cabin) => cabin.rates.some((rate) => rate.schedule_type === scheduleType))?.id || null);
  }

  async function handleReservation(event) {
    event.preventDefault();
    if (!selectedCabin || !date || !userName.trim() || !userPhone.trim()) {
      alert('객실, 이용일, 예약자 이름과 연락처를 모두 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from('reservations').insert({
      user_name: userName.trim(),
      user_phone: userPhone.trim(),
      cruise_id: cruise.id,
      cabin_id: selectedCabin.id,
      reservation_date: date,
      guests_count: adults + children + infants,
      total_price: 0,
      status: 'pending',
    });
    setSubmitting(false);

    if (error) {
      console.error('Reservation inquiry failed:', error.message);
      alert('예약 문의를 접수하지 못했습니다. 카카오톡 상담으로 연락해 주세요.');
      return;
    }

    alert('예약 문의가 접수되었습니다. 객실 가능 여부와 최종 요금 확인 후 연락드리겠습니다.');
    setDate('');
    setUserName('');
    setUserPhone('');
  }

  if (loading) {
    return (
      <div className="product-state product-state-loading">
        <span>STAY HALONG / PREPARING YOUR JOURNEY</span>
        <h1>좋은 여행을<br />불러오는 중입니다.</h1>
        <i aria-hidden="true" />
        <p>v2 크루즈와 객실 정보를 확인하고 있습니다.</p>
      </div>
    );
  }

  if (!cruise || loadError) {
    return (
      <div className="product-state product-state-error">
        <span>STAY HALONG / NOT FOUND</span>
        <h2>상품을 찾을 수 없습니다.</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  const heroImage = cruise.heroImage || '/images/cruises/headimage.png';
  const duration = cruise.schedules.map((type) => SCHEDULE_LABELS[type]).filter(Boolean).join(' · ');

  return (
    <div className="product-page">
      <div
        className="product-hero"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: 'var(--navy)',
        }}
      >
        <div className="product-hero-bg" />
      </div>

      <div className="container product-content-wrapper">
        <main className="product-main">
          <header className="product-header">
            <span className="duration-badge">{duration}</span>
            <h1>{cruise.name}</h1>
            {cruise.nameEn && <p className="product-subtitle">{cruise.nameEn}</p>}
            <p className="product-desc">{cruise.description || 'Stay Halong이 엄선한 하롱베이 크루즈입니다.'}</p>
            <div className="product-facts">
              {cruise.category && <span>{cruise.category}</span>}
              {cruise.rating && <span>★ {cruise.rating}</span>}
              {cruise.tags.map((tag) => <span key={tag}>#{tag}</span>)}
            </div>
          </header>

          {archiveGroups.some((group) => group.id !== 'main') && (
            <section className="product-section product-photo-archive">
              <CruiseMediaGallery
                cruiseName={cruise.name}
                category={cruise.category}
                duration={duration}
                heroImage={heroImage}
                groups={archiveGroups}
                showMain={false}
              />
            </section>
          )}

          <section className="product-section">
            <div className="section-heading-row">
              <h2>객실 및 등록 요금</h2>
              <label className="schedule-picker">
                <span>일정</span>
                <select value={selectedSchedule} onChange={handleScheduleChange}>
                  {cruise.schedules.map((type) => <option key={type} value={type}>{SCHEDULE_LABELS[type]}</option>)}
                </select>
              </label>
            </div>
            <p className="price-notice">v2 이관 요금은 현재 가격 단위가 확정되지 않았습니다. 아래 금액은 비교용 등록값이며 최종 견적이 아닙니다.</p>
            <div className="cabins-list">
              {availableCabins.map((cabin, index) => {
                const rate = chooseRate(cabin, selectedSchedule, date);
                const cabinMedia = cabinMediaById.get(cabin.id);
                return (
                  <div
                    key={cabin.id}
                    className={`cabin-card ${selectedCabin?.id === cabin.id ? 'active' : ''}`}
                  >
                    {cabinMedia ? (
                      <CruiseMediaGallery
                        cruiseName={cruise.name}
                        heroImage={cabin.imageUrl || `/cabin_${(index % 5) + 1}.png`}
                        groups={[cabinMedia]}
                        mainGroupId={cabinMedia.id}
                        mainClassName="cabin-image cabin-gallery-trigger"
                        showArchive={false}
                        showMainMeta={false}
                      />
                    ) : (
                      <span className="cabin-image" style={{ backgroundImage: `url(${cabin.imageUrl || `/cabin_${(index % 5) + 1}.png`})` }} />
                    )}
                    <button type="button" className="cabin-select-button" onClick={() => setSelectedCabinId(cabin.id)}>
                      <span className="cabin-info">
                        <strong>{cabin.name}</strong>
                        <small>{[cabin.roomArea && `면적 ${cabin.roomArea}`, cabin.bedType && `침대 ${cabin.bedType}`, cabin.maxGuests && `최대 ${cabin.maxGuests}명`].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="cabin-price">
                        <small>등록요금 참고</small>
                        <strong>{formatVnd(rate?.price_adult, rate?.currency)}</strong>
                      </span>
                    </button>
                    <button type="button" className="cabin-detail-button" onClick={() => { setSelectedCabinId(cabin.id); setDetailCabinId(cabin.id); }}>상세 안내 <span>↗</span></button>
                  </div>
                );
              })}
            </div>
          </section>

        </main>

        <aside className="product-sidebar">
          <div className="reservation-card sticky">
            <h3>예약 문의</h3>
            <p className="reservation-intro">실시간 객실과 최종 금액은 현지 데스크 확인 후 안내합니다.</p>
            <form className="reservation-form" onSubmit={handleReservation}>
              <div className="form-group">
                <label>선택한 객실</label>
                <input type="text" value={selectedCabin?.name || '객실을 선택하세요'} readOnly />
              </div>
              <div className="form-group">
                <label htmlFor="schedule">일정</label>
                <select id="schedule" value={selectedSchedule} onChange={handleScheduleChange}>
                  {cruise.schedules.map((type) => <option key={type} value={type}>{SCHEDULE_LABELS[type]}</option>)}
                </select>
              </div>
              <div className="guest-grid">
                <div className="form-group"><label htmlFor="adults">성인</label><select id="adults" value={adults} onChange={(event) => setAdults(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((number) => <option key={number}>{number}</option>)}</select></div>
                <div className="form-group"><label htmlFor="children">아동</label><select id="children" value={children} onChange={(event) => setChildren(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((number) => <option key={number}>{number}</option>)}</select></div>
                <div className="form-group"><label htmlFor="infants">유아</label><select id="infants" value={infants} onChange={(event) => setInfants(Number(event.target.value))}>{[0, 1, 2, 3].map((number) => <option key={number}>{number}</option>)}</select></div>
              </div>
              <div className="form-group">
                <label htmlFor="date">이용일</label>
                <input type="date" id="date" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
              {date && !selectedRate && <p className="date-warning">선택일에 적용되는 등록 요금이 없습니다. 문의 접수 후 별도 확인합니다.</p>}
              <div className="form-group">
                <label htmlFor="userName">예약자 성함</label>
                <input type="text" id="userName" value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="이름" required />
              </div>
              <div className="form-group">
                <label htmlFor="userPhone">연락처</label>
                <input type="tel" id="userPhone" value={userPhone} onChange={(event) => setUserPhone(event.target.value)} placeholder="010-1234-5678" required />
              </div>
              <div className="total-price-box">
                <span>등록 요금 참고</span>
                <strong className="total-amount">{formatVnd(selectedRate?.price_adult, selectedRate?.currency)}</strong>
                <small>가격 단위·아동 규정·최종 합계는 상담 확인</small>
              </div>
              <button type="submit" className="btn-primary w-100" disabled={submitting || !selectedCabin}>
                {submitting ? '문의 접수 중...' : '예약 문의 접수'}
              </button>
              <a className="kakao-link" href="http://pf.kakao.com/_zvsxaG/chat" target="_blank" rel="noreferrer">카카오톡으로 바로 상담 ↗</a>
            </form>
          </div>
        </aside>
      </div>

      {detailCabin && (
        <div className="cabin-detail-modal" role="dialog" aria-modal="true" aria-labelledby="cabin-detail-title" onClick={(event) => { if (event.target === event.currentTarget) setDetailCabinId(null); }}>
          <section className="cabin-detail-modal-panel">
            <header>
              <div><span>CABIN DETAIL</span><h2 id="cabin-detail-title">{detailCabin.name} 객실 안내</h2></div>
              <button type="button" onClick={() => setDetailCabinId(null)} aria-label="객실 상세 안내 닫기">닫기 ×</button>
            </header>
            <div className="cabin-detail-modal-content">
              {detailCabin.nameEn && <p className="cabin-name-en">{detailCabin.nameEn}</p>}
              <div className="feature-list">
                {cabinFeatures(detailCabin).map((feature) => <span key={feature}>{feature}</span>)}
              </div>
              {detailCabin.specialAmenities && <div className="amenity-note"><strong>스페셜 어메니티</strong><p>{detailCabin.specialAmenities}</p></div>}
              {detailFacilities.length > 0 && <div className="facility-block"><strong>등록 시설</strong><div>{detailFacilities.map((facility) => <span key={facility}>{facility}</span>)}</div></div>}
              <div className="rate-reference">
                <strong>선택 조건의 등록 요금</strong>
                <dl>
                  <div><dt>기준 등록값</dt><dd>{formatVnd(detailRate?.price_adult, detailRate?.currency)}</dd></div>
                  <div><dt>아동 등록값</dt><dd>{formatVnd(detailRate?.price_child, detailRate?.currency)}</dd></div>
                  <div><dt>유아 등록값</dt><dd>{formatVnd(detailRate?.price_infant, detailRate?.currency)}</dd></div>
                  <div><dt>유효 기간</dt><dd>{detailRate ? `${detailRate.valid_from} ~ ${detailRate.valid_to}` : '선택일 적용 요금 없음'}</dd></div>
                  <div><dt>가격 단위</dt><dd>{detailRate?.price_basis === 'unknown' || !detailRate ? '상담 확인 필요' : detailRate.price_basis}</dd></div>
                </dl>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
