import { supabase } from '@/lib/supabase';
import { unstable_cache } from 'next/cache';
import { getHomepageDatabase } from '@/lib/homepage-admin';
import { resolveR2PublicMediaUrl } from '@/lib/public-media-url';
import HotelCollection from './HotelCollection';
import './hotels.css';

export const dynamic = 'force-dynamic';

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function proxiedImageUrl(imageUrl) {
  return resolveR2PublicMediaUrl(imageUrl);
}

async function getHotelRecommendationPriorities() {
  const database = getHomepageDatabase();
  if (!database) return new Map();
  try {
    const { data, error } = await database
      .from('hotel_recommendation_priorities_v2')
      .select('product_id,position')
      .eq('criterion_tag', 'default')
      .order('position');
    if (error) throw error;
    return new Map((data || []).map((row) => [row.product_id, Number(row.position)]));
  } catch (error) {
    console.warn('[hotels] recommendation priority lookup skipped', error?.message || error);
    return new Map();
  }
}

async function getHotels() {
  const [productsResult, pricesResult, priorities] = await Promise.all([
    supabase
      .from('catalog_products_v2')
      .select('id,source_key,name_ko,description,category,image_url,metadata,manual_override')
      .eq('source', 'sht-platform')
      .eq('service_type', 'hotel')
      .eq('is_active', true)
      .order('name_ko'),
    supabase
      .from('catalog_prices_v2')
      .select('product_id,price_amount,currency')
      .eq('source', 'sht-platform')
      .eq('source_table', 'hotel_price')
      .eq('is_active', true),
    getHotelRecommendationPriorities(),
  ]);

  if (productsResult.error) {
    console.error('Failed to load hotels:', productsResult.error.message);
    return [];
  }
  if (pricesResult.error) console.error('Failed to load hotel prices:', pricesResult.error.message);

  const minimumPrices = new Map();
  for (const price of pricesResult.data || []) {
    const amount = positiveNumber(price.price_amount);
    if (!amount) continue;
    const current = minimumPrices.get(price.product_id);
    if (!current || amount < current.amount) minimumPrices.set(price.product_id, { amount, currency: price.currency || 'VND' });
  }

  const catalogHotels = (productsResult.data || []).map((hotel) => {
    const metadata = hotel.metadata || {};
    const manualOverride = hotel.manual_override || {};
    const price = minimumPrices.get(hotel.id) || null;
    const imageUrl = proxiedImageUrl(manualOverride.image_url || hotel.image_url) || '';
    return {
      id: hotel.id,
      name: manualOverride.name_ko || hotel.name_ko,
      description: manualOverride.description ?? hotel.description,
      location: metadata.location || '지역 확인 중',
      rating: positiveNumber(metadata.star_rating),
      minPrice: price?.amount || null,
      currency: price?.currency || 'VND',
      imageUrl,
      priorityPosition: priorities.get(hotel.id) ?? null,
    };
  });

  return catalogHotels.sort((left, right) => {
    const leftRanked = Number.isFinite(left.priorityPosition);
    const rightRanked = Number.isFinite(right.priorityPosition);
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    if (leftRanked && left.priorityPosition !== right.priorityPosition) return left.priorityPosition - right.priorityPosition;
    return left.name.localeCompare(right.name, 'ko');
  });
}

// 관리자 저장 때 태그를 즉시 만료하므로 공개 조회는 5분간 재사용한다.
const getCachedHotels = unstable_cache(
  getHotels,
  ['public-hotel-listing-v2'],
  { revalidate: 300, tags: ['public-hotel-listing'] },
);

export default async function Hotels() {
  const hotels = await getCachedHotels();

  return (
    <div className="hotel-page">
      <header className="hotel-page-header">
        <div className="container">
          <span>02 / STAY COLLECTION</span>
          <h1>럭셔리 호텔 예약</h1>
          <p>크루즈 일정의 전후를 더 편안하게 잇는 하롱베이와 하노이의 엄선된 호텔을 소개합니다.</p>
        </div>
      </header>

      <main className="container hotel-page-content">
        {hotels.length === 0 ? (
          <div className="hotel-collection-empty">
            <strong>현재 공개된 호텔이 없습니다.</strong>
            <p>호텔 상품 공개 상태를 확인하거나 현지 데스크에 문의해 주세요.</p>
          </div>
        ) : (
          <HotelCollection hotels={hotels} />
        )}
      </main>
    </div>
  );
}
