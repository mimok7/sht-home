import { getHomepageDatabase } from '@/lib/homepage-admin';
import { resolvePublicMediaUrl } from '@/lib/public-media-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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
      const images = await loadRows(database, 'homepage_cruise_images', 'cruise_name', key);
      return Response.json({ service, images: images.map(publicImage).filter(Boolean) }, {
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
