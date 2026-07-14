import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import './cruises.css';

import { MOCK_CRUISES } from '@/data/cruisesData';

async function getCruises() {
  try {
    // 1. Fetch unique cruises from cruise_info
    const { data: rawCruisesData, error: cruisesError } = await supabase
      .from('cruise_info')
      .select('*');
      
    if (cruisesError || !rawCruisesData || rawCruisesData.length === 0) {
      return MOCK_CRUISES;
    }

    // Group by cruise name to get unique cruises
    const uniqueCruisesMap = new Map();
    rawCruisesData.forEach(item => {
      if (!uniqueCruisesMap.has(item.name)) {
        // Keep the first item as the representative for the cruise
        uniqueCruisesMap.set(item.name, item);
      }
    });
    const cruisesData = Array.from(uniqueCruisesMap.values());


    // 2. Fetch min price from cruise_rate_card for each cruise
    const { data: rateData, error: rateError } = await supabase
      .from('cruise_rate_card')
      .select('cruise_name, price_adult');

    // 3. Fetch cruise locations
    const { data: locationData } = await supabase
      .from('cruise_location')
      .select('en_name, kr_name, pier_location, pier_map_url');

    // 4. Fetch active promotions
    const { data: promoData } = await supabase
      .from('cruise_promotion')
      .select('cruise_name, name')
      .eq('is_active', true);

    const rates = rateData || [];
    const locations = locationData || [];
    const promos = promoData || [];

    // Provide default mock images since DB images are mostly null
    const mockImages = [
      '/yacht_1.png', '/yacht_2.png', '/yacht_3.png', '/halong-hero.png'
    ];

    return cruisesData.map((cruise, index) => {
      // Find prices for this cruise
      const cruiseRates = rates.filter(r => r.cruise_name && (r.cruise_name.includes(cruise.name) || cruise.name.includes(r.cruise_name)));
      
      let min_price = 4000000;
      if (cruiseRates.length > 0) {
        min_price = Math.min(...cruiseRates.map(r => r.price_adult || 99999999));
      }

      if (min_price === 99999999) min_price = 4000000;

      // Find location (matching en_name case-insensitive)
      const location = locations.find(loc => 
        loc.en_name && cruise.name && loc.en_name.toLowerCase() === cruise.name.toLowerCase()
      );

      // Find promotions
      // Note: promos use cruise_name (Korean). We will match loosely if we don't have the Korean name in view.
      // But cruise_info_view doesn't have the Korean name. So we match with what we can.
      const hasPromo = promos.some(p => p.cruise_name && cruiseRates.some(r => r.cruise_name === p.cruise_name));

      // Ensure we have an image
      let imageUrl = cruise.images ? cruise.images : null;
      if (!imageUrl || imageUrl === 'null' || imageUrl === '[]') {
        imageUrl = mockImages[index % mockImages.length];
      }

      return {
        id: cruise.id,
        name: cruise.name,
        description: cruise.description || '하롱베이 최고의 크루즈입니다.',
        duration: cruise.duration,
        rating: 4.8 + (index % 3) * 0.1,
        image_url: imageUrl,
        min_price,
        location: location ? location.pier_location : null,
        map_url: location ? location.pier_map_url : null,
        hasPromo
      };
    });
  } catch (err) {
    // Supabase may be unavailable during build or local development.
    // The page has a complete local fallback, so keep this expected case quiet.
    return MOCK_CRUISES;
  }
}

export default async function Cruises() {
  const cruises = await getCruises();

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="container">
          <h1>럭셔리 크루즈 예약</h1>
          <p>하롱베이의 수만 개의 섬들 사이를 누비는 5성급 호텔, 인생 최고의 하루를 선사합니다.</p>
        </div>
      </div>
      
      <div className="container py-4">
        <div className="filter-bar">
          <div className="filter-group">
            <select className="filter-select">
              <option>일정 전체</option>
              <option>당일 크루즈</option>
              <option>1박 2일</option>
              <option>2박 3일</option>
            </select>
            <select className="filter-select">
              <option>등급 전체</option>
              <option>5성급 럭셔리</option>
              <option>4성급 스탠다드</option>
            </select>
          </div>
          <div className="sort-group">
            <select className="filter-select">
              <option>추천순</option>
              <option>인기순</option>
              <option>낮은 가격순</option>
            </select>
          </div>
        </div>

        <div className="product-list">
          {cruises.map(cruise => (
            <Link href={`/product/${encodeURIComponent(cruise.name)}`} key={cruise.id} className="product-list-card">
              <div 
                className="product-image-box" 
                style={{ 
                  backgroundImage: cruise.image_url ? `url(${cruise.image_url})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {cruise.hasPromo && <span className="badge" style={{ backgroundColor: '#ef4444' }}>🔥 특가 프로모션</span>}
                {!cruise.hasPromo && <span className="badge">5★ STAR</span>}
                <div className="duration-tag">{cruise.duration}</div>
              </div>
              <div className="product-details">
                <h2>{cruise.name}</h2>
                <p>{cruise.description}</p>
                {cruise.location && (
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                    📍 {cruise.location}
                  </p>
                )}
                <div className="product-meta">
                  <div className="rating">⭐⭐⭐⭐⭐ ({cruise.rating})</div>
                  <div className="price">
                    <span>{cruise.min_price.toLocaleString()} VND</span> / 1인 최저가
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
