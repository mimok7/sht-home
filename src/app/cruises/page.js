import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import './cruises.css';

const FALLBACK_IMAGES = ['/yacht_1.png', '/yacht_2.png', '/yacht_3.png', '/halong-hero.png'];
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };

export const revalidate = 300;

function normalizeImagePath(imageUrl) {
  return imageUrl
    ?.replace(/^\/images\/cruises\/(yacht_[^/]+)$/, '/$1')
    ?.replace('/images/cruises/c9_official.jpg', '/yacht_1.png');
}

function buildCruiseCards(rows) {
  const cruises = new Map();

  for (const row of rows) {
    if (!row.cruise_id || !row.cruise_name) continue;
    if (!cruises.has(row.cruise_id)) {
      cruises.set(row.cruise_id, {
        id: row.cruise_id,
        slug: row.slug,
        name: row.cruise_name,
        nameEn: row.cruise_name_en,
        description: row.description,
        category: row.category,
        rating: row.star_rating,
        heroImage: row.hero_image,
        minPrice: null,
        currency: row.currency || 'VND',
        scheduleTypes: new Set(),
        tags: new Set(row.tags || []),
      });
    }

    const cruise = cruises.get(row.cruise_id);
    cruise.scheduleTypes.add(row.schedule_type);
    for (const tag of row.tags || []) cruise.tags.add(tag);
    if (Number.isFinite(row.price_adult) && row.price_adult > 0 && (cruise.minPrice === null || row.price_adult < cruise.minPrice)) {
      cruise.minPrice = row.price_adult;
      cruise.currency = row.currency || 'VND';
    }
  }

  return [...cruises.values()]
    .map((cruise, index) => ({
      ...cruise,
      duration: [...cruise.scheduleTypes].map((type) => SCHEDULE_LABELS[type]).filter(Boolean).join(' · '),
      imageUrl: normalizeImagePath(cruise.heroImage) || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length],
    }))
    .sort((a, b) => (a.minPrice ?? Number.MAX_SAFE_INTEGER) - (b.minPrice ?? Number.MAX_SAFE_INTEGER));
}

async function getCruises() {
  const { data, error } = await supabase
    .from('public_cruise_recommendation_v2')
    .select('cruise_id,slug,cruise_name,cruise_name_en,description,category,star_rating,hero_image,schedule_type,currency,price_adult,tags');

  if (error) {
    console.error('Failed to load v2 cruise collection:', error.message);
    return [];
  }
  return buildCruiseCards(data || []);
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
            <select className="filter-select" defaultValue="all" aria-label="일정 필터">
              <option value="all">일정 전체</option>
              <option value="DAY">당일 크루즈</option>
              <option value="1N2D">1박 2일</option>
              <option value="2N3D">2박 3일</option>
            </select>
            <select className="filter-select" defaultValue="all" aria-label="등급 필터">
              <option value="all">등급 전체</option>
              <option value="5">5성급 럭셔리</option>
              <option value="4">4성급 스탠다드</option>
            </select>
          </div>
          <div className="sort-group">
            <select className="filter-select" defaultValue="price" aria-label="정렬 순서">
              <option value="price">등록요금 낮은 순</option>
            </select>
          </div>
        </div>

        {cruises.length === 0 ? (
          <div className="collection-empty">
            <strong>현재 공개된 v2 크루즈가 없습니다.</strong>
            <p>상품 활성화 상태를 확인하거나 현지 데스크에 문의해 주세요.</p>
          </div>
        ) : (
          <div className="product-list">
            {cruises.map((cruise) => (
              <Link href={`/product/${encodeURIComponent(cruise.slug)}`} key={cruise.id} className="product-list-card">
                <div
                  className="product-image-box"
                  style={{ backgroundImage: `url(${cruise.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <span className="badge">{cruise.category || 'CURATED'}</span>
                  <div className="duration-tag">{cruise.duration || '일정 확인'}</div>
                </div>
                <div className="product-details">
                  <h2>{cruise.name}</h2>
                  <p>{cruise.description || cruise.nameEn || 'Stay Halong이 엄선한 하롱베이 크루즈입니다.'}</p>
                  <div className="product-meta">
                    <div className="rating">{cruise.rating ? `★ ${cruise.rating}` : '등급 확인 필요'}</div>
                    <div className="price">
                      {cruise.minPrice ? (
                        <><span>{cruise.minPrice.toLocaleString()} {cruise.currency}</span> 등록요금부터 · 단위 확인 필요</>
                      ) : (
                        <span>요금 확인 필요</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
