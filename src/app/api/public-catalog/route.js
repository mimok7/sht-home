import { getHomepageDatabase } from '@/lib/homepage-admin';
import { resolvePublicMediaUrl } from '@/lib/public-media-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function publicMediaList(...values) {
  const urls = values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => resolvePublicMediaUrl(value))
    .filter(Boolean);
  return [...new Set(urls)];
}

async function loadRows(database, sourceTable, keyField, key) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await database
      .from('platform_source_records')
      .select('source_id,payload')
      .eq('source', 'sht-platform')
      .eq('source_table', sourceTable)
      .eq(`payload->>${keyField}`, key)
      .order('source_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map((row) => ({ ...(row.payload || {}), __source_id: row.source_id }));
}

function publicImage(image) {
  const url = resolvePublicMediaUrl(image.image_url, image.storage_bucket, image.storage_path)
    || resolvePublicMediaUrl(image.source_image_url);
  if (!url) return null;
  return {
    id: text(image.id) || text(image.__source_id) || url,
    roomName: text(image.room_name),
    roomNameEn: text(image.room_name_en),
    hotelPriceCode: text(image.hotel_price_code),
    collection: text(image.collection),
    imageName: text(image.image_name),
    url,
    sortOrder: Number(image.sort_order) || 0,
    isPrimary: Boolean(image.is_primary),
  };
}

function publicCruiseRate(rate) {
  const scheduleType = text(rate.schedule_type);
  const roomName = text(rate.room_type) || text(rate.room_name);
  const platformRateCardId = text(rate.id) || text(rate.__source_id);
  if (!scheduleType || !roomName || !platformRateCardId || rate.is_active === false || rate.is_active === 'false') return null;

  return {
    id: platformRateCardId,
    scheduleType,
    roomName,
    roomNameEn: text(rate.room_type_en) || text(rate.room_name_en),
    validFrom: text(rate.valid_from),
    validTo: text(rate.valid_to),
    currency: text(rate.currency) || 'VND',
    priceAdult: Number(rate.price_adult) || null,
    priceChild: Number(rate.price_child) || null,
    priceInfant: Number(rate.price_infant) || null,
    priceSingle: Number(rate.price_single) || null,
    priceExtraBed: Number(rate.price_extra_bed) || null,
    singleAvailable: Boolean(rate.single_available),
    extraBedAvailable: Boolean(rate.extra_bed_available),
    platformRateCardId,
  };
}

function publicCruiseCabin(cabin) {
  const name = text(cabin.room_name);
  if (!name) return null;
  const images = publicMediaList(cabin.room_image, cabin.room_images);
  return {
    id: text(cabin.id) || text(cabin.__source_id) || name,
    name,
    nameEn: text(cabin.room_name_en),
    imageUrl: images[0] || '',
    images,
    roomArea: text(cabin.room_area),
    bedType: text(cabin.bed_type),
    maxAdults: Number(cabin.max_adults) || null,
    maxGuests: Number(cabin.max_guests) || null,
    hasBalcony: Boolean(cabin.has_balcony),
    isVip: Boolean(cabin.is_vip),
    hasButler: Boolean(cabin.has_butler),
    isRecommended: Boolean(cabin.is_recommended),
    connectingAvailable: Boolean(cabin.connecting_available),
    extraBedAvailable: Boolean(cabin.extra_bed_available),
    facilities: cabin.facilities || [],
    specialAmenities: text(cabin.special_amenities),
    description: text(cabin.room_description),
    inclusions: text(cabin.inclusions),
    exclusions: text(cabin.exclusions),
    warnings: text(cabin.warnings),
  };
}

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
  const service = searchParams.get('service');
  const key = text(searchParams.get('key'));
  if (!['cruise', 'hotel'].includes(service) || !key || key.length > 200) {
    return Response.json({ error: '요청한 상품 정보를 확인할 수 없습니다.' }, { status: 400 });
  }

  const database = getHomepageDatabase();
  if (!database) return Response.json({ error: '상품 정보를 불러올 수 없습니다.' }, { status: 503 });

  try {
    if (service === 'cruise') {
      const [images, rates, cabins] = await Promise.all([
        loadRows(database, 'homepage_cruise_images', 'cruise_name', key),
        loadRows(database, 'cruise_rate_card', 'cruise_name', key),
        loadRows(database, 'cruise_info', 'cruise_name', key),
      ]);
      return Response.json({
        service,
        images: images.map(publicImage).filter(Boolean),
        rates: rates.map(publicCruiseRate).filter(Boolean),
        cabins: cabins.map(publicCruiseCabin).filter(Boolean),
      }, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      });
    }

    const [infoRows, priceRows, imageRows] = await Promise.all([
      loadRows(database, 'hotel_info', 'hotel_code', key),
      loadRows(database, 'hotel_price', 'hotel_code', key),
      loadRows(database, 'homepage_hotel_images', 'hotel_code', key),
    ]);
    const info = infoRows[0] || {};
    return Response.json({
      service,
      hotel: {
        code: key,
        name: text(info.hotel_name) || text(priceRows[0]?.hotel_name) || key,
        description: text(info.notes),
        location: text(info.location),
        rating: Number(info.star_rating) || null,
      },
      rooms: priceRows.map((room) => ({
        id: text(room.hotel_price_code) || text(room.__source_id),
        name: text(room.room_name) || text(room.room_type) || '객실',
        roomType: text(room.room_type),
        category: text(room.room_category),
        maxGuests: Number(room.occupancy_max) || null,
        breakfast: room.include_breakfast,
        childPolicy: text(room.child_policy),
        notes: text(room.notes),
        validFrom: text(room.start_date),
        validTo: text(room.end_date),
        price: Number(room.base_price) || null,
        currency: text(room.currency) || 'VND',
        priceUnit: 'per_room',
      })),
      images: imageRows.map(publicImage).filter(Boolean),
    }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (error) {
    console.error('[public-catalog] source lookup failed', error?.message || error);
    return Response.json({ error: '상품 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
