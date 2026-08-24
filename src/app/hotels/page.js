import { supabase } from '@/lib/supabase';
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

async function getHotels() {
  const [productsResult, pricesResult, imagesResult] = await Promise.all([
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
    if (images.has(image.product_id)) continue;
    const imageUrl = image.image_url || publicStorageUrl(image.storage_bucket, image.storage_path);
    if (imageUrl) images.set(image.product_id, imageUrl);
  }

  return (productsResult.data || []).map((hotel) => {
    const metadata = hotel.metadata || {};
    const manualOverride = hotel.manual_override || {};
    const price = minimumPrices.get(hotel.id) || null;
    return {
      id: hotel.id,
      name: hotel.name_ko,
      description: hotel.description,
      location: metadata.location || '지역 확인 중',
      rating: positiveNumber(metadata.star_rating),
      minPrice: price?.amount || null,
      currency: price?.currency || 'VND',
      imageUrl: manualOverride.image_url || hotel.image_url || images.get(hotel.id) || '',
    };
  });
}

export default async function Hotels() {
  const hotels = await getHotels();

  return (
    <div className="hotel-page">
      <header className="hotel-page-header">
        <div className="container">
          <span>02 / STAY COLLECTION</span>
          <h1>하롱베이 호텔 예약</h1>
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
