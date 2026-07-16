'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import './product.css';

const PRODUCT_COLUMNS = 'cruise_id,slug,cruise_name,cruise_name_en,description,category,star_rating,hero_image,itinerary_id,schedule_type,nights,cabin_id,cabin_name,cabin_name_en,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,rate_plan_id,valid_from,valid_to,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,tags';
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };
const SCHEDULE_ORDER = ['DAY', '1N2D', '2N3D'];

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
  const [selectedCabinId, setSelectedCabinId] = useState(null);
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
  const facilities = parseFacilities(selectedCabin?.facilities);

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
                return (
                  <button
                    type="button"
                    key={cabin.id}
                    className={`cabin-card ${selectedCabin?.id === cabin.id ? 'active' : ''}`}
                    onClick={() => setSelectedCabinId(cabin.id)}
                  >
                    <span className="cabin-image" style={{ backgroundImage: `url(/cabin_${(index % 5) + 1}.png)` }} />
                    <span className="cabin-info">
                      <strong>{cabin.name}</strong>
                      <small>{[cabin.roomArea && `면적 ${cabin.roomArea}`, cabin.bedType && `침대 ${cabin.bedType}`, cabin.maxGuests && `최대 ${cabin.maxGuests}명`].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="cabin-price">
                      <small>등록요금 참고</small>
                      <strong>{formatVnd(rate?.price_adult, rate?.currency)}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedCabin && (
            <section className="cabin-detail">
              <h2>{selectedCabin.name} 객실 안내</h2>
              {selectedCabin.nameEn && <p className="cabin-name-en">{selectedCabin.nameEn}</p>}
              <div className="feature-list">
                {cabinFeatures(selectedCabin).map((feature) => <span key={feature}>{feature}</span>)}
              </div>
              {selectedCabin.specialAmenities && (
                <div className="amenity-note">
                  <strong>스페셜 어메니티</strong>
                  <p>{selectedCabin.specialAmenities}</p>
                </div>
              )}
              {facilities.length > 0 && (
                <div className="facility-block">
                  <strong>등록 시설</strong>
                  <div>{facilities.map((facility) => <span key={facility}>{facility}</span>)}</div>
                </div>
              )}
              <div className="rate-reference">
                <strong>선택 조건의 등록 요금</strong>
                <dl>
                  <div><dt>기준 등록값</dt><dd>{formatVnd(selectedRate?.price_adult, selectedRate?.currency)}</dd></div>
                  <div><dt>아동 등록값</dt><dd>{formatVnd(selectedRate?.price_child, selectedRate?.currency)}</dd></div>
                  <div><dt>유아 등록값</dt><dd>{formatVnd(selectedRate?.price_infant, selectedRate?.currency)}</dd></div>
                  <div><dt>유효 기간</dt><dd>{selectedRate ? `${selectedRate.valid_from} ~ ${selectedRate.valid_to}` : '선택일 적용 요금 없음'}</dd></div>
                  <div><dt>가격 단위</dt><dd>{selectedRate?.price_basis === 'unknown' || !selectedRate ? '상담 확인 필요' : selectedRate.price_basis}</dd></div>
                </dl>
              </div>
            </section>
          )}
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
    </div>
  );
}
