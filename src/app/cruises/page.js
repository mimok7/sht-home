import { supabase } from '@/lib/supabase';
import CruiseCollection from './CruiseCollection';
import './cruises.css';

const FALLBACK_IMAGES = ['/yacht_1.png', '/yacht_2.png', '/yacht_3.png', '/halong-hero.png'];
const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };

// 관리자에서 공개 상태를 변경한 직후에도 목록이 이전 캐시를 보여주지 않도록
// 공개 크루즈 상태는 요청마다 최신값을 조회한다.
export const dynamic = 'force-dynamic';

function normalizeImagePath(imageUrl) {
  return imageUrl
    ?.replace(/^\/images\/cruises\/(yacht_[^/]+)$/, '/$1')
    ?.replace('/images/cruises/c9_official.jpg', '/yacht_1.png');
}

function buildCruiseCards(cruiseRows, itineraryRows, recommendationRows) {
  const cruises = new Map();

  for (const row of cruiseRows) {
    cruises.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name_ko,
      nameEn: row.name_en,
      description: row.description,
      rating: row.star_rating,
      heroImage: row.hero_image,
      minPrice: null,
      currency: 'VND',
      scheduleTypes: new Set(),
      tags: new Set(),
    });
  }

  for (const row of recommendationRows) {
    if (!row.cruise_id || !row.cruise_name) continue;
    if (!cruises.has(row.cruise_id)) {
      cruises.set(row.cruise_id, {
        id: row.cruise_id,
        slug: row.slug,
        name: row.cruise_name,
        nameEn: row.cruise_name_en,
        description: row.description,
        rating: row.star_rating,
        heroImage: row.hero_image,
        minPrice: null,
        currency: row.currency || 'VND',
        scheduleTypes: new Set(),
        tags: new Set(row.tags || []),
      });
    }

    const cruise = cruises.get(row.cruise_id);
    for (const tag of row.tags || []) cruise.tags.add(tag);
    if (Number.isFinite(row.price_adult) && row.price_adult > 0 && (cruise.minPrice === null || row.price_adult < cruise.minPrice)) {
      cruise.minPrice = row.price_adult;
      cruise.currency = row.currency || 'VND';
    }
  }

  for (const row of itineraryRows) {
    if (row.cruise_id && row.schedule_type && cruises.has(row.cruise_id)) {
      cruises.get(row.cruise_id).scheduleTypes.add(row.schedule_type);
    }
  }

  return [...cruises.values()]
    .map((cruise, index) => ({
      ...cruise,
      duration: [...cruise.scheduleTypes].map((type) => SCHEDULE_LABELS[type]).filter(Boolean).join(' · '),
      imageUrl: normalizeImagePath(cruise.heroImage) || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length],
    }))
    .map((cruise) => ({ ...cruise, scheduleTypes: [...cruise.scheduleTypes] }));
}

async function getCruiseMainImages(cruiseIds) {
  if (!cruiseIds.length) return new Map();
  const { data, error } = await supabase
    .from('cruise_cafe_import_images_v2')
    .select('id,cruise_id,image_name,storage_bucket,storage_path,sort_order,created_at')
    .in('cruise_id', cruiseIds)
    .is('cabin_id', null)
    .order('sort_order')
    .order('created_at');

  if (error) {
    console.error('Failed to load cruise main images:', error.message);
    return new Map();
  }

  const imagesByCruise = new Map();
  for (const row of data || []) {
    const filename = row.image_name || row.storage_path?.split('/').pop() || '';
    if (!/^main-/i.test(filename)) continue;
    const url = supabase.storage.from(row.storage_bucket).getPublicUrl(row.storage_path).data.publicUrl;
    if (!imagesByCruise.has(row.cruise_id)) imagesByCruise.set(row.cruise_id, []);
    const images = imagesByCruise.get(row.cruise_id);
    if (!images.some((image) => image.url === url)) images.push({ id: row.id, url, alt: `${filename} 대표 이미지` });
  }
  return imagesByCruise;
}

async function getCruises() {
  const [cruiseResult, itineraryResult, recommendationResult] = await Promise.all([
    supabase
      .from('cruises_v2')
      .select('id,slug,name_ko,name_en,description,star_rating,hero_image')
      .eq('is_active', true)
      .order('name_ko'),
    supabase
      .from('cruise_itineraries_v2')
      .select('cruise_id,schedule_type')
      .eq('is_active', true),
    supabase
      .from('public_cruise_recommendation_v2')
      .select('cruise_id,slug,cruise_name,cruise_name_en,description,star_rating,hero_image,schedule_type,currency,price_adult,tags'),
  ]);

  if (cruiseResult.error) {
    console.error('Failed to load active v2 cruises:', cruiseResult.error.message);
    return [];
  }
  if (recommendationResult.error) {
    console.error('Failed to load v2 cruise prices:', recommendationResult.error.message);
  }
  if (itineraryResult.error) {
    console.error('Failed to load active v2 itineraries:', itineraryResult.error.message);
  }
  const itineraryRows = itineraryResult.error ? recommendationResult.data || [] : itineraryResult.data || [];
  return buildCruiseCards(cruiseResult.data || [], itineraryRows, recommendationResult.data || []);
}

export default async function Cruises() {
  const cruises = await getCruises();
  const mainImagesByCruise = await getCruiseMainImages(cruises.map((cruise) => cruise.id));
  const cruiseCards = cruises.map((cruise) => ({
    ...cruise,
    mainImages: mainImagesByCruise.get(cruise.id) || [{ id: 'hero', url: cruise.imageUrl, alt: `${cruise.name} 대표 이미지` }],
  }));

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="container">
          <h1>럭셔리 크루즈 예약</h1>
          <p>하롱베이의 수만 개의 섬들 사이를 누비는 5성급 호텔, 인생 최고의 하루를 선사합니다.</p>
        </div>
      </div>

      <div className="container py-4">
        {cruiseCards.length === 0 ? (
          <div className="collection-empty">
            <strong>현재 공개된 v2 크루즈가 없습니다.</strong>
            <p>상품 활성화 상태를 확인하거나 현지 데스크에 문의해 주세요.</p>
          </div>
        ) : (
          <CruiseCollection cruises={cruiseCards} />
        )}
      </div>
    </div>
  );
}
