import { supabase } from '@/lib/supabase';
import CruiseCollection from './CruiseCollection';
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
