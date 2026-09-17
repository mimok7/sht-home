import { supabase } from '@/lib/supabase';
import { unstable_cache } from 'next/cache';
import { resolveR2PublicMediaUrl } from '@/lib/public-media-url';
import CruiseCollection from './CruiseCollection';
import './cruises.css';

const SCHEDULE_LABELS = { DAY: '당일', '1N2D': '1박 2일', '2N3D': '2박 3일' };
// R2에서 제거된 예전 파일은 목록의 기본 후보에서 제외한다.
// 선택된 초기 이미지나 상세 갤러리에는 영향을 주지 않는다.
const UNAVAILABLE_LISTING_IMAGE_PATHS = new Set([
  'cruises/be0b433c-f528-45b7-8c0a-4e3c155d8b66/official-structured/exterior/35d22ba3fba2.jpg',
]);

// 화면 자체는 동적으로 유지하되, 목록 구성에 필요한 대량 이미지 조회는 짧게 재사용한다.
// 관리자 변경 사항은 최대 30초 안에 목록에 반영된다.
export const dynamic = 'force-dynamic';

function normalizeImagePath(imageUrl) {
  return resolveR2PublicMediaUrl(imageUrl);
}

function listingImageCandidate(imageName) {
  const name = String(imageName || '').trim().toLowerCase();
  const exterior = name.match(/^exterior-(\d+)(?:\.[a-z0-9]+)?$/);
  if (exterior) return { priority: 0, sequence: Number(exterior[1]) };

  const main = name.match(/^main-(\d+)(?:\.[a-z0-9]+)?$/);
  if (main) return { priority: 1, sequence: Number(main[1]) };

  return null;
}

function buildListingImageUrls(imageRows, initialImageIds) {
  const listingImages = new Map();
  const selectedInitialImages = new Map();

  for (const row of imageRows) {
    if (!row.cruise_id || row.cabin_id) continue;

    const candidateType = listingImageCandidate(row.image_name);
    const imageUrl = resolveR2PublicMediaUrl('', row.storage_bucket, row.storage_path);
    if (!imageUrl) continue;
    if (UNAVAILABLE_LISTING_IMAGE_PATHS.has(row.storage_path)) continue;
    if (initialImageIds.get(row.cruise_id) === row.id) selectedInitialImages.set(row.cruise_id, imageUrl);
    if (!candidateType) continue;

    const candidate = {
      imageUrl,
      ...candidateType,
      sortOrder: Number(row.sort_order) || 0,
      createdAt: row.created_at || '',
    };
    const current = listingImages.get(row.cruise_id);
    const isBetterCandidate = !current
      || candidate.priority < current.priority
      || (candidate.priority === current.priority && candidate.sequence < current.sequence)
      || (candidate.priority === current.priority && candidate.sequence === current.sequence && candidate.sortOrder < current.sortOrder)
      || (candidate.priority === current.priority && candidate.sequence === current.sequence && candidate.sortOrder === current.sortOrder && candidate.createdAt < current.createdAt);

    if (isBetterCandidate) listingImages.set(row.cruise_id, candidate);
  }

  return {
    initialImages: selectedInitialImages,
    listingImages: new Map([...listingImages.entries()].map(([cruiseId, image]) => [cruiseId, image.imageUrl])),
  };
}

function buildCruiseCards(cruiseRows, itineraryRows, recommendationRows, imageUrls) {
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
      initialImageId: row.initial_image_id,
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
      // 목록은 선박 외관을 우선 사용하고, 상세 페이지에서만 전체 갤러리를 보여 준다.
      imageUrl: imageUrls.initialImages.get(cruise.id) || imageUrls.listingImages.get(cruise.id) || normalizeImagePath(cruise.heroImage) || '',
    }))
    .map((cruise) => ({ ...cruise, scheduleTypes: [...cruise.scheduleTypes] }));
}

async function getCruises() {
  const [cruiseResult, itineraryResult, recommendationResult] = await Promise.all([
    supabase
      .from('cruises_v2')
      .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image,initial_image_id')
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

  const cruiseRows = cruiseResult.data || [];
  const cruiseIds = cruiseRows.map((cruise) => cruise.id).filter(Boolean);
  const imageResult = cruiseIds.length
    ? await supabase
      .from('cruise_cafe_import_images_v2')
      .select('id,cruise_id,cabin_id,image_name,storage_bucket,storage_path,sort_order,created_at')
      .in('cruise_id', cruiseIds)
      .or('image_name.ilike.exterior-%,image_name.ilike.main-%')
    : { data: [], error: null };
  if (imageResult.error) {
    console.error('Failed to load cruise default images:', imageResult.error.message);
  }

  const itineraryRows = itineraryResult.error ? recommendationResult.data || [] : itineraryResult.data || [];
  const imageUrls = imageResult.error
    ? { initialImages: new Map(), listingImages: new Map() }
    : buildListingImageUrls(imageResult.data || [], new Map(cruiseRows.map((cruise) => [cruise.id, cruise.initial_image_id])));
  return buildCruiseCards(
    cruiseRows,
    itineraryRows,
    recommendationResult.data || [],
    imageUrls,
  );
}

async function getCruiseCards() {
  return getCruises();
}

const getCachedCruiseCards = unstable_cache(
  getCruiseCards,
  ['public-cruise-listing-v10'],
  { revalidate: 300, tags: ['public-cruise-listing'] },
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
