import { supabase } from '@/lib/supabase';
import { unstable_cache } from 'next/cache';
import { platformStorageUrl, resolvePublicMediaUrl } from '@/lib/public-media-url';
import CruiseCollection from './CruiseCollection';
import './cruises.css';

const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };

// 화면 자체는 동적으로 유지하되, 목록 구성에 필요한 대량 이미지 조회는 짧게 재사용한다.
// 관리자 변경 사항은 최대 30초 안에 목록에 반영된다.
export const dynamic = 'force-dynamic';

function normalizeImagePath(imageUrl) {
  return resolvePublicMediaUrl(imageUrl)
    ?.replace(/^\/images\/cruises\/(yacht_[^/]+)$/, '/$1')
    ?.replace('/images/cruises/c9_official.jpg', '/yacht_1.png');
}

function buildCruiseCards(cruiseRows, itineraryRows, recommendationRows) {
  const cruises = new Map();

  for (const row of cruiseRows) {
    cruises.set(row.id, {
      id: row.id,
      slug: row.slug,
      legacyName: row.legacy_name,
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
        legacyName: row.cruise_name,
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
    .map((cruise) => ({
      ...cruise,
      duration: [...cruise.scheduleTypes].map((type) => SCHEDULE_LABELS[type]).filter(Boolean).join(' · '),
      imageUrl: normalizeImagePath(cruise.heroImage) || '',
    }))
    .map((cruise) => ({ ...cruise, scheduleTypes: [...cruise.scheduleTypes] }));
}

function addImage(imagesByCruise, cruiseId, image) {
  if (!cruiseId || !image?.url) return;
  if (!imagesByCruise.has(cruiseId)) imagesByCruise.set(cruiseId, []);
  const images = imagesByCruise.get(cruiseId);
  if (!images.some((current) => current.url === image.url)) images.push(image);
}

function isMainImage(image) {
  const filename = image.storage_path?.split('/').pop() || image.image_name || '';
  const category = String(image.image_name || filename).match(/^(main|exterior|interior|menu)-/i)?.[1]?.toLowerCase();
  if (category) return category === 'main';
  return Boolean(image.is_primary) || /^main-/i.test(filename);
}

async function getCruiseMainImages(cruises) {
  const cruiseIds = cruises.map((cruise) => cruise.id);
  if (!cruiseIds.length) return new Map();
  const { data, error } = await supabase
    .from('cruise_cafe_import_images_v2')
    .select('id,cruise_id,image_name,storage_bucket,storage_path,sort_order,is_primary,created_at')
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
    const pathFilename = row.storage_path?.split('/').pop() || '';
    const filename = pathFilename || row.image_name || '';
    if (!isMainImage(row)) continue;
    const url = platformStorageUrl(row.storage_bucket, row.storage_path);
    addImage(imagesByCruise, row.cruise_id, { id: row.id, url, alt: `${filename} 대표 이미지` });
  }

  return imagesByCruise;
}

async function getCruises() {
  const [cruiseResult, itineraryResult, recommendationResult] = await Promise.all([
    supabase
      .from('cruises_v2')
      .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image')
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

async function getCruiseCards() {
  const cruises = await getCruises();
  const mainImagesByCruise = await getCruiseMainImages(cruises);
  return cruises.map((cruise) => ({
    ...cruise,
    mainImages: mainImagesByCruise.get(cruise.id) || (cruise.imageUrl
      ? [{ id: 'hero', url: cruise.imageUrl, alt: `${cruise.name} 대표 이미지` }]
      : []),
  }));
}

const getCachedCruiseCards = unstable_cache(
  getCruiseCards,
  ['public-cruise-listing-v2'],
  { revalidate: 30, tags: ['public-cruise-listing'] },
);

export default async function Cruises() {
  const cruiseCards = await getCachedCruiseCards();

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
