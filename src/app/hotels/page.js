import { supabase } from '@/lib/supabase';
import { getHomepageDatabase } from '@/lib/homepage-admin';
import HotelCollection from './HotelCollection';
import './hotels.css';

export const dynamic = 'force-dynamic';

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function publicStorageUrl(bucket, path) {
  if (!bucket || !path) return '';
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function proxiedImageUrl(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (/tthwqfhdojncqtwfssqe\.supabase\.co\/storage\/v1\/object\/public\/homepage-images/i.test(imageUrl)) return '';
  try {
    if (!new URL(imageUrl).hostname.endsWith('.supabase.co')) return imageUrl;
  } catch {
    return imageUrl;
  }
  return `/api/public-image?url=${encodeURIComponent(imageUrl)}`;
}

async function getHotelSourceImages() {
  const database = getHomepageDatabase();
  if (!database) return new Map();
  try {
    const { data, error } = await database
      .from('platform_source_records')
      .select('payload')
      .eq('source', 'sht-platform')
      .eq('source_table', 'homepage_hotel_images')
      .limit(3000);
    if (error) throw error;

    const imagesByHotelCode = new Map();
    for (const row of data || []) {
      const image = row.payload || {};
      const hotelCode = String(image.hotel_code || '').trim();
      const imageUrl = proxiedImageUrl(image.source_image_url || image.image_url);
      if (!hotelCode || !imageUrl) continue;
      if (!imagesByHotelCode.has(hotelCode)) imagesByHotelCode.set(hotelCode, []);
      imagesByHotelCode.get(hotelCode).push({
        id: String(image.id || imageUrl),
        url: imageUrl,
        alt: image.image_name || '호텔 이미지',
        sortOrder: Number(image.sort_order) || 0,
        isPrimary: Boolean(image.is_primary),
      });
    }
    for (const images of imagesByHotelCode.values()) {
      images.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder);
    }
    return imagesByHotelCode;
  } catch (error) {
    console.warn('[hotels] source image fallback lookup skipped', error?.message || error);
    return new Map();
  }
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
  const [productsResult, pricesResult, imagesResult, priorities, sourceImagesByHotelCode] = await Promise.all([
    supabase
      .from('catalog_products_v2')
      .select('id,name_ko,description,category,image_url,metadata,manual_override')
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
    supabase
      .from('hotel_gallery_images_v2')
      .select('product_id,image_url,storage_bucket,storage_path,sort_order,is_primary')
      .is('hotel_price_code', null)
      .order('is_primary', { ascending: false })
      .order('sort_order'),
    getHotelRecommendationPriorities(),
    getHotelSourceImages(),
  ]);

  if (productsResult.error) {
    console.error('Failed to load hotels:', productsResult.error.message);
    return [];
  }
  if (pricesResult.error) console.error('Failed to load hotel prices:', pricesResult.error.message);
  if (imagesResult.error) console.error('Failed to load hotel images:', imagesResult.error.message);

  const minimumPrices = new Map();
  for (const price of pricesResult.data || []) {
    const amount = positiveNumber(price.price_amount);
    if (!amount) continue;
    const current = minimumPrices.get(price.product_id);
    if (!current || amount < current.amount) minimumPrices.set(price.product_id, { amount, currency: price.currency || 'VND' });
  }

  const images = new Map();
  for (const image of imagesResult.data || []) {
    const imageUrl = proxiedImageUrl(image.image_url || publicStorageUrl(image.storage_bucket, image.storage_path));
    if (!imageUrl) continue;
    if (!images.has(image.product_id)) images.set(image.product_id, []);
    const productImages = images.get(image.product_id);
    if (!productImages.some((current) => current.url === imageUrl)) {
      productImages.push({ id: `${image.product_id}-${image.sort_order}-${productImages.length}`, url: imageUrl, alt: '호텔 대표 이미지' });
    }
  }

  return (productsResult.data || []).map((hotel) => {
    const metadata = hotel.metadata || {};
    const manualOverride = hotel.manual_override || {};
    const price = minimumPrices.get(hotel.id) || null;
    const sourceImages = sourceImagesByHotelCode.get(hotel.source_key) || [];
    const imageUrl = proxiedImageUrl(manualOverride.image_url || hotel.image_url) || images.get(hotel.id)?.[0]?.url || sourceImages[0]?.url || '';
    const mainImages = [
      ...(imageUrl ? [{ id: `${hotel.id}-hero`, url: imageUrl, alt: `${hotel.name_ko} 대표 이미지` }] : []),
      ...(images.get(hotel.id) || []),
      ...sourceImages,
    ].filter((image, index, all) => all.findIndex((current) => current.url === image.url) === index);
    return {
      id: hotel.id,
      name: manualOverride.name_ko || hotel.name_ko,
      description: manualOverride.description ?? hotel.description,
      location: metadata.location || '지역 확인 중',
      rating: positiveNumber(metadata.star_rating),
      minPrice: price?.amount || null,
      currency: price?.currency || 'VND',
      imageUrl,
      mainImages,
      priorityPosition: priorities.get(hotel.id) ?? null,
    };
  }).sort((left, right) => {
    const leftRanked = Number.isFinite(left.priorityPosition);
    const rightRanked = Number.isFinite(right.priorityPosition);
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    if (leftRanked && left.priorityPosition !== right.priorityPosition) return left.priorityPosition - right.priorityPosition;
    return left.name.localeCompare(right.name, 'ko');
  });
}

export default async function Hotels() {
  const hotels = await getHotels();

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
