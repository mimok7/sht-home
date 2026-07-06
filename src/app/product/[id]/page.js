'use client';

import { useState, useEffect, use } from 'react';
import { supabase } from '@/lib/supabase';
import './product.css';

export default function ProductDetail({ params }) {
  const unwrappedParams = use(params);
  const id = unwrappedParams.id;
  const [loading, setLoading] = useState(true);
  const [cruise, setCruise] = useState(null);
  const [location, setLocation] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [selectedCabin, setSelectedCabin] = useState(null);
  
  // Extra Data
  const [tourOptions, setTourOptions] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promoRates, setPromoRates] = useState([]);

  // Dynamic Pricing States
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [extraBed, setExtraBed] = useState(false);
  const [singleRoom, setSingleRoom] = useState(false);
  
  // Selected Options
  const [selectedOptions, setSelectedOptions] = useState({});
  
  const [date, setDate] = useState('');
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const decodedId = decodeURIComponent(id);

        // 1 & 2. Fetch Cruise and Cabins from cruise_info
        const { data: cabinsData, error: cruiseError } = await supabase
          .from('cruise_info')
          .select('*')
          .eq('name', decodedId);

        if (cruiseError || !cabinsData || cabinsData.length === 0) {
          console.error("Supabase fetch failed", cruiseError, "decodedId:", decodedId, "id:", id);
          setLoading(false);
          // Set a fake cruise object just to display the error
          setCruise({ error_debug: `Fetch failed for id: ${id}, decoded: ${decodedId}` });
          return;
        }

        const cruiseData = cabinsData[0];
        const cruiseNameEn = cruiseData.name;
        const cruiseNameKr = cruiseData.cruise_name || '';

        // 3. Parallel fetch for all other 9 tables
        const [ratesRes, promoRes, promoRatesRes, surchargeRes, optionsRes, locationRes] = await Promise.all([
          supabase.from('cruise_rate_card').select('*'),
          supabase.from('cruise_promotion').select('*').eq('is_active', true),
          supabase.from('cruise_promotion_rate').select('*'),
          supabase.from('cruise_holiday_surcharge').select('*'),
          supabase.from('cruise_tour_options').select('*').eq('is_active', true),
          supabase.from('cruise_location').select('*')
        ]);

        const ratesData = ratesRes.data || [];
        setPromotions(promoRes.data || []);
        setPromoRates(promoRatesRes.data || []);
        
        const cruiseHolidays = (surchargeRes.data || []).filter(h => h.cruise_name === cruiseNameKr || (h.cruise_name && cruiseNameKr && h.cruise_name.includes(cruiseNameKr)));
        setHolidays(cruiseHolidays);

        const cruiseOptions = (optionsRes.data || []).filter(o => o.cruise_name === cruiseNameKr || (o.cruise_name && cruiseNameKr && o.cruise_name.includes(cruiseNameKr)));
        setTourOptions(cruiseOptions);

        const loc = (locationRes.data || []).find(l => l.en_name && l.en_name.toLowerCase() === cruiseNameEn.toLowerCase());
        setLocation(loc);

        // Merge Cabins with Base Rates
        let mergedCabins = [];
        if (cabinsData && cabinsData.length > 0) {
          mergedCabins = cabinsData.map(cabin => {
            const rate = ratesData.find(r => 
              (r.cruise_name === cabin.cruise_name || (r.cruise_name && cabin.cruise_name && r.cruise_name.includes(cabin.cruise_name))) && 
              (r.room_type_en === cabin.room_name || r.room_type === cabin.room_name || (r.room_type_en && cabin.room_name && r.room_type_en.toLowerCase().includes(cabin.room_name.toLowerCase())))
            );

            return {
              ...cabin,
              rate: rate || {
                price_adult: 0, price_child: 0, price_infant: 0,
                price_extra_bed: 0, price_single: 0
              }
            };
          });
        }

        setCruise({ ...cruiseData, cruise_name: cruiseNameKr });
        setCabins(mergedCabins);
        
        if (mergedCabins.length > 0) {
          setSelectedCabin(mergedCabins[0]);
        }
      } catch (err) {
        console.error("Error loading product detail:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  const handleOptionToggle = (optionId) => {
    setSelectedOptions(prev => ({
      ...prev,
      [optionId]: !prev[optionId]
    }));
  };

  const isDateInSurcharge = (checkDate, holiday) => {
    if (!checkDate || !holiday.holiday_date) return false;
    return holiday.holiday_date.includes(checkDate.substring(5));
  };

  const calculateTotal = () => {
    if (!selectedCabin || !selectedCabin.rate) return 0;
    
    let currentRate = selectedCabin.rate;
    const promo = promotions.find(p => p.cruise_name === cruise?.cruise_name);
    if (promo) {
      const pRate = promoRates.find(pr => pr.promotion_id === promo.id && (pr.room_type === selectedCabin.room_name || pr.room_type === selectedCabin.room_type));
      if (pRate) {
        currentRate = { ...currentRate, ...pRate };
      }
    }

    let total = (adults * (currentRate.price_adult || 0)) +
                (children * (currentRate.price_child || 0)) +
                (infants * (currentRate.price_infant || 0));
                
    if (extraBed) total += (currentRate.price_extra_bed || 0);
    if (singleRoom) total += (currentRate.price_single || 0);
    
    let surchargeTotal = 0;
    if (date) {
      const appliedHoliday = holidays.find(h => isDateInSurcharge(date, h));
      if (appliedHoliday) {
        const surchargeVal = parseInt(appliedHoliday.surcharge_per_person) || 0;
        surchargeTotal = (adults + children) * surchargeVal;
        total += surchargeTotal;
      }
    }

    tourOptions.forEach(opt => {
      if (selectedOptions[opt.option_id]) {
        const price = parseInt(opt.option_price) || 0;
        total += price; 
      }
    });
    
    return total;
  };

  const handleReservation = async (e) => {
    e.preventDefault();
    if (!date) {
      alert('예약 날짜를 선택해주세요.');
      return;
    }
    if (!userName || !userPhone) {
      alert('예약자 이름과 연락처를 입력해주세요.');
      return;
    }

    try {
      setSubmitting(true);
      const totalPrice = calculateTotal();

      const { data, error } = await supabase
        .from('reservations')
        .insert([
          {
            user_name: userName,
            user_phone: userPhone,
            cruise_id: id,
            cabin_id: selectedCabin ? selectedCabin.id : null,
            reservation_date: date,
            guests_count: adults + children + infants,
            total_price: totalPrice,
            status: 'pending'
          }
        ]);

      if (error) throw error;

      alert(`예약이 성공적으로 완료되었습니다!\n상담원이 조만간 ${userPhone} 번호로 연락드릴 예정입니다.`);
      setDate('');
      setUserName('');
      setUserPhone('');
      setSelectedOptions({});
    } catch (err) {
      console.error("Reservation failed:", err);
      alert(`[데모 모드 완료] 예약이 가상으로 완료되었습니다.\n예약자: ${userName}\n총 금액: ${calculateTotal().toLocaleString()} VND`);
    } finally {
      setSubmitting(false);
    }
  };

  const safeParseJSON = (str) => {
    try {
      if (!str) return null;
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  };

  if (loading) {
    return <div className="container" style={{ padding: '8rem 2rem', textAlign: 'center' }}>로딩 중...</div>;
  }

  if (!cruise || cruise.error_debug) {
    return (
      <div className="container" style={{ padding: '8rem 2rem', textAlign: 'center' }}>
        <h2>상품을 찾을 수 없습니다.</h2>
        {cruise?.error_debug && (
          <p style={{ color: 'red', marginTop: '1rem' }}>Debug: {cruise.error_debug}</p>
        )}
      </div>
    );
  }
  
  const cruiseImage = (cruise.images && cruise.images !== 'null' && cruise.images !== '[]') ? cruise.images : '/yacht_1.png';
  
  // Parse Itinerary and Cancellation
  const itineraryData = selectedCabin?.itinerary ? safeParseJSON(selectedCabin.itinerary) : null;
  const cancellationData = selectedCabin?.cancellation_policy ? safeParseJSON(selectedCabin.cancellation_policy) : null;
  const facilitiesData = selectedCabin?.facilities ? safeParseJSON(selectedCabin.facilities) : null;

  return (
    <div className="product-page">
      <div 
        className="product-hero"
        style={{ 
          backgroundImage: `url(${cruiseImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div className="product-hero-bg" style={{ background: 'rgba(10, 35, 66, 0.4)' }}></div>
      </div>
      
      <div className="container product-content-wrapper">
        <div className="product-main">
          <div className="product-header">
            <span className="duration-badge">{cruise.duration}</span>
            <h1>{cruise.name} {cruise.cruise_name ? `(${cruise.cruise_name})` : ''}</h1>
            <p className="product-desc">{cruise.description}</p>
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {selectedCabin?.star_rating && (
                <span style={{ padding: '4px 12px', backgroundColor: '#fef3c7', color: '#d97706', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                  ⭐ {selectedCabin.star_rating}
                </span>
              )}
              {selectedCabin?.capacity && (
                <span style={{ padding: '4px 12px', backgroundColor: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                  👥 최대 인원: {selectedCabin.capacity}
                </span>
              )}
              {selectedCabin?.awards && selectedCabin.awards !== 'null' && (
                <span style={{ padding: '4px 12px', backgroundColor: '#fce7f3', color: '#be185d', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                  🏆 {selectedCabin.awards}
                </span>
              )}
            </div>

            {location && (
              <div style={{marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f1f5f9', borderRadius: '8px', display: 'flex', gap: '1rem', alignItems: 'center'}}>
                <span style={{fontSize: '1.2rem'}}>📍</span>
                <div>
                  <div style={{fontWeight: 'bold', color: '#0f172a'}}>탑승 위치</div>
                  <div style={{color: '#64748b', fontSize: '0.9rem'}}>{location.pier_location}</div>
                  {location.pier_map_url && (
                    <a href={location.pier_map_url} target="_blank" rel="noreferrer" style={{color: '#0ea5e9', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginTop: '4px', fontWeight: 'bold'}}>
                      구글 맵에서 보기 →
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 객실 선택 섹션 */}
          <div className="product-section">
            <h2>객실 및 요금 정보</h2>
            <div className="cabins-list">
              {cabins.map((cabin, idx) => {
                const promo = promotions.find(p => p.cruise_name === cruise?.cruise_name);
                const hasPromoRate = promo && promoRates.some(pr => pr.promotion_id === promo.id && (pr.room_type === cabin.room_name || pr.room_type === cabin.room_type));

                return (
                  <div 
                    key={cabin.id || idx} 
                    className={`cabin-card ${selectedCabin?.id === cabin.id ? 'active' : ''}`}
                    onClick={() => setSelectedCabin(cabin)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1.5rem',
                      padding: '1.5rem',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {hasPromoRate && (
                      <div style={{position: 'absolute', top: 0, right: 0, backgroundColor: '#ef4444', color: 'white', padding: '4px 12px', fontSize: '0.75rem', fontWeight: 'bold', borderBottomLeftRadius: '8px'}}>
                        특가할인
                      </div>
                    )}
                    <div style={{
                      width: '100px',
                      height: '80px',
                      borderRadius: '8px',
                      backgroundImage: `url(${cabin.room_image || `/cabin_${(idx % 5) + 1}.png`})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      flexShrink: 0
                    }} />
                    <div className="cabin-info" style={{ flex: 1 }}>
                      <h3>{cabin.room_name}</h3>
                      {cabin.room_area || cabin.bed_type ? (
                        <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '0.2rem', fontWeight: '500'}}>
                          {cabin.room_area && `면적: ${cabin.room_area}`} 
                          {cabin.room_area && cabin.bed_type && ' | '}
                          {cabin.bed_type && `침대: ${cabin.bed_type}`}
                        </p>
                      ) : null}
                    </div>
                    <div className="cabin-price" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div style={{fontSize: '0.8rem', color: '#64748b'}}>성인 1인 기준</div>
                      {hasPromoRate && cabin.rate?.price_adult > 0 && (
                        <div style={{fontSize: '0.8rem', color: '#ef4444', textDecoration: 'line-through'}}>
                          {cabin.rate.price_adult.toLocaleString()} VND
                        </div>
                      )}
                      <div style={{fontWeight: '700', color: '#0f172a'}}>
                        {(cabin.rate?.price_adult || 0).toLocaleString()} VND
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 객실 상세 정보 표시 (선택된 객실 기준) */}
          {selectedCabin && (
            <div style={{ backgroundColor: '#f8fafc', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '3rem' }}>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#0f172a' }}>{selectedCabin.room_name} 객실 안내</h2>
              
              {selectedCabin.room_description && selectedCabin.room_description !== 'null' && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', color: '#334155' }}>
                    {selectedCabin.room_description}
                  </p>
                </div>
              )}

              {selectedCabin.special_amenities && selectedCabin.special_amenities !== 'null' && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '8px' }}>
                  <strong style={{ display: 'block', color: '#1e3a8a', marginBottom: '0.5rem' }}>✨ 스페셜 어메니티 & 혜택</strong>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#1e40af', fontSize: '0.95rem' }}>
                    {selectedCabin.special_amenities}
                  </p>
                </div>
              )}

              {selectedCabin.warnings && selectedCabin.warnings !== 'null' && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', borderRadius: '4px' }}>
                  <strong style={{ display: 'block', color: '#991b1b', marginBottom: '0.5rem' }}>⚠️ 중요 안내 및 주의사항</strong>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#b91c1c', fontSize: '0.95rem', margin: 0 }}>
                    {selectedCabin.warnings}
                  </p>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {selectedCabin.inclusions && selectedCabin.inclusions !== 'null' && (
                  <div>
                    <h3 style={{ fontSize: '1.1rem', color: '#166534', marginBottom: '0.8rem', borderBottom: '2px solid #bbf7d0', paddingBottom: '0.5rem' }}>⭕ 포함 사항</h3>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', color: '#334155', fontSize: '0.95rem' }}>
                      {selectedCabin.inclusions.replace(/\\n/g, '\n')}
                    </p>
                  </div>
                )}
                {selectedCabin.exclusions && selectedCabin.exclusions !== 'null' && (
                  <div>
                    <h3 style={{ fontSize: '1.1rem', color: '#991b1b', marginBottom: '0.8rem', borderBottom: '2px solid #fecaca', paddingBottom: '0.5rem' }}>❌ 불포함 사항</h3>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', color: '#334155', fontSize: '0.95rem' }}>
                      {selectedCabin.exclusions.replace(/\\n/g, '\n')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 일정표 (Itinerary) */}
          {itineraryData && Array.isArray(itineraryData) && (
            <div className="product-section">
              <h2>운항 일정표</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {itineraryData.map((day, idx) => (
                  <div key={idx} style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ backgroundColor: '#f8fafc', padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', fontWeight: 'bold', color: '#0f172a' }}>
                      {day.title || `${day.day}일차`}
                    </div>
                    <div style={{ padding: '1.5rem' }}>
                      {day.schedule && day.schedule.map((item, i) => (
                        <div key={i} style={{ display: 'flex', gap: '1.5rem', marginBottom: i === day.schedule.length - 1 ? 0 : '1rem' }}>
                          <div style={{ fontWeight: 'bold', color: '#0ea5e9', minWidth: '60px' }}>{item.time}</div>
                          <div style={{ color: '#334155', lineHeight: '1.5' }}>{item.activity}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 부대시설 */}
          {facilitiesData && Array.isArray(facilitiesData) && facilitiesData.length > 0 && (
            <div className="product-section">
              <h2>크루즈 부대시설</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                {facilitiesData.map((fac, idx) => (
                  <span key={idx} style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', color: '#334155', borderRadius: '20px', fontSize: '0.9rem', border: '1px solid #e2e8f0' }}>
                    {fac}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 취소 규정 */}
          {cancellationData && Array.isArray(cancellationData) && (
            <div className="product-section">
              <h2>취소 및 환불 규정</h2>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ backgroundColor: '#f8fafc' }}>
                    <tr>
                      <th style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', color: '#475569', width: '50%' }}>조건 (기준)</th>
                      <th style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', color: '#475569', width: '50%' }}>위약금 / 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancellationData.map((policy, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', color: '#334155', lineHeight: '1.5' }}>{policy.condition}</td>
                        <td style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', color: '#ef4444', fontWeight: '500', lineHeight: '1.5' }}>{policy.penalty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="product-sidebar">
          <div className="reservation-card sticky">
            <h3 style={{marginTop: 0, marginBottom: '1.5rem', color: '#0f172a'}}>예약 요금 계산기</h3>
            
            <form className="reservation-form" onSubmit={handleReservation}>
              <div className="form-group">
                <label>선택한 객실</label>
                <input 
                  type="text" 
                  value={selectedCabin ? selectedCabin.room_name : '객실을 선택하세요'} 
                  readOnly 
                  style={{ backgroundColor: '#f1f5f9', fontWeight: '600' }}
                />
              </div>

              {/* Dynamic Pricing Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>성인</label>
                  <select value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                    {[1,2,3,4,5,6].map(num => (
                      <option key={num} value={num}>{num}명</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>아동 (만 5~11세)</label>
                  <select value={children} onChange={(e) => setChildren(Number(e.target.value))}>
                    {[0,1,2,3,4].map(num => (
                      <option key={num} value={num}>{num}명</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                  <label>유아 (만 4세 이하)</label>
                  <select value={infants} onChange={(e) => setInfants(Number(e.target.value))}>
                    {[0,1,2,3].map(num => (
                      <option key={num} value={num}>{num}명</option>
                    ))}
                  </select>
              </div>

              {/* Optional Extras */}
              {(selectedCabin?.rate?.price_extra_bed > 0 || selectedCabin?.rate?.price_single > 0) && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  {selectedCabin?.rate?.price_extra_bed > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.8rem' }}>
                      <input 
                        type="checkbox" 
                        id="extraBed" 
                        checked={extraBed} 
                        onChange={(e) => setExtraBed(e.target.checked)}
                        style={{ marginRight: '8px', width: 'auto' }}
                      />
                      <label htmlFor="extraBed" style={{ marginBottom: 0, flex: 1, cursor: 'pointer', fontSize: '0.9rem' }}>엑스트라 베드 추가</label>
                      <span style={{ fontSize: '0.85rem', color: '#0ea5e9', fontWeight: '600' }}>
                        +{selectedCabin.rate.price_extra_bed.toLocaleString()}
                      </span>
                    </div>
                  )}
                  
                  {selectedCabin?.rate?.price_single > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="checkbox" 
                        id="singleRoom" 
                        checked={singleRoom} 
                        onChange={(e) => setSingleRoom(e.target.checked)}
                        style={{ marginRight: '8px', width: 'auto' }}
                      />
                      <label htmlFor="singleRoom" style={{ marginBottom: 0, flex: 1, cursor: 'pointer', fontSize: '0.9rem' }}>싱글 룸 차지</label>
                      <span style={{ fontSize: '0.85rem', color: '#0ea5e9', fontWeight: '600' }}>
                        +{selectedCabin.rate.price_single.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {tourOptions.length > 0 && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <div style={{fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '0.5rem', color: '#166534'}}>투어 추가 옵션</div>
                  {tourOptions.map(opt => (
                    <div key={opt.option_id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <input 
                        type="checkbox" 
                        id={`opt-${opt.option_id}`} 
                        checked={selectedOptions[opt.option_id] || false} 
                        onChange={() => handleOptionToggle(opt.option_id)}
                        style={{ marginRight: '8px', width: 'auto' }}
                      />
                      <label htmlFor={`opt-${opt.option_id}`} style={{ marginBottom: 0, flex: 1, cursor: 'pointer', fontSize: '0.85rem' }}>
                        {opt.option_name}
                      </label>
                      <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: '600' }}>
                        +{(parseInt(opt.option_price) || 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="date">예약 날짜</label>
                <input 
                  type="date" 
                  id="date" 
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required 
                />
              </div>
              
              {/* Holiday warning */}
              {date && holidays.some(h => isDateInSurcharge(date, h)) && (
                <div style={{ marginBottom: '1rem', padding: '0.8rem', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', borderRadius: '4px', fontSize: '0.85rem', color: '#991b1b' }}>
                  ⚠️ 선택하신 날짜는 명절/공휴일 할증이 적용되는 기간입니다. (총 금액에 자동 합산됨)
                </div>
              )}

              <div className="form-group">
                <label htmlFor="userName">예약자 성함</label>
                <input 
                  type="text" 
                  id="userName" 
                  placeholder="예약자 이름을 입력하세요"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  required 
                />
              </div>

              <div className="form-group">
                <label htmlFor="userPhone">연락처</label>
                <input 
                  type="tel" 
                  id="userPhone" 
                  placeholder="010-1234-5678"
                  value={userPhone}
                  onChange={(e) => setUserPhone(e.target.value)}
                  required 
                />
              </div>
              
              <div className="total-price-box" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.9rem', color: '#64748b' }}>
                  <span>총 결제 예정 금액</span>
                  <span>({adults + children + infants}명)</span>
                </div>
                <span className="total-amount" style={{ color: '#ef4444', fontSize: '1.8rem' }}>
                  {calculateTotal().toLocaleString()} <span style={{fontSize: '1rem'}}>VND</span>
                </span>
              </div>
              
              <button 
                type="submit" 
                className="btn-primary w-100" 
                disabled={submitting}
              >
                {submitting ? '예약 처리 중...' : '예약 신청하기'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
