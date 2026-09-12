import { unstable_cache } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { loadPublicCatalog } from '@/lib/public-catalog-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRUISE_COLUMNS = 'cruise_id,slug,cruise_name,cruise_name_en,description,star_rating,hero_image,itinerary_id,schedule_type,nights,cabin_id,cabin_name,cabin_name_en,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,rate_plan_id,valid_from,valid_to,price_basis,currency,price_adult,price_child,price_infant,price_single,price_extra_bed,single_available,tags';
const CABIN_COLUMNS = 'id,legacy_room_name,name_ko,name_en,image_url,room_area_text,bed_type,max_adults,max_guests,has_balcony,is_vip,has_butler,is_recommended,connecting_available,extra_bed_available,facilities,special_amenities,is_active';

function detailError(message) {
  const error = new Error(message);
  error.publicMessage = '상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  return error;
}

async function loadCruiseDetail(id, includeMedia) {
  let recommendationResult = await supabase
    .from('public_cruise_recommendation_v2')
    .select(CRUISE_COLUMNS)
    .eq('slug', id);

  if (!recommendationResult.error && !recommendationResult.data?.length) {
    recommendationResult = await supabase
      .from('public_cruise_recommendation_v2')
      .select(CRUISE_COLUMNS)
      .eq('cruise_name', id);
  }
  if (recommendationResult.error) throw detailError(recommendationResult.error.message);

  const rows = recommendationResult.data || [];
  let catalog = null;
  let itineraryRows = [];
  let cruiseId = rows[0]?.cruise_id || '';

  if (!cruiseId) {
    let catalogResult = await supabase
      .from('cruises_v2')
      .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image')
      .eq('slug', id)
      .eq('is_active', true)
      .maybeSingle();
    if (!catalogResult.error && !catalogResult.data) {
      catalogResult = await supabase
        .from('cruises_v2')
        .select('id,slug,legacy_name,name_ko,name_en,description,star_rating,hero_image')
        .eq('name_ko', id)
        .eq('is_active', true)
        .maybeSingle();
    }
    if (catalogResult.error) throw detailError(catalogResult.error.message);
    catalog = catalogResult.data;
    cruiseId = catalog?.id || '';
    if (!cruiseId) return { notFound: true };

    const itineraryResult = await supabase
      .from('cruise_itineraries_v2')
      .select('schedule_type')
      .eq('cruise_id', cruiseId)
      .eq('is_active', true);
    if (itineraryResult.error) throw detailError(itineraryResult.error.message);
    itineraryRows = itineraryResult.data || [];
  }

  const [cabinsResult, importsResult] = await Promise.all([
    supabase.from('cabins_v2').select(CABIN_COLUMNS).eq('cruise_id', cruiseId),
    includeMedia
      ? supabase
        .from('cruise_cafe_import_images_v2')
        .select('id,cabin_id,image_name,storage_bucket,storage_path,sort_order,is_primary,created_at')
        .eq('cruise_id', cruiseId)
        .order('created_at')
        .order('sort_order')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cabinsResult.error || importsResult.error) throw detailError(cabinsResult.error?.message || importsResult.error?.message);

  const cabinIds = (cabinsResult.data || []).map((cabin) => cabin.id);
  const cabinImagesPromise = includeMedia && cabinIds.length
    ? supabase
      .from('cabin_images_v2')
      .select('id,cabin_id,storage_bucket,storage_path,alt_text,sort_order,is_primary,created_at')
      .in('cabin_id', cabinIds)
      .order('sort_order')
    : { data: [], error: null };
  const cabinImagesResult = await cabinImagesPromise;
  if (cabinImagesResult.error) throw detailError(cabinImagesResult.error.message);

  return {
    notFound: false,
    rows,
    catalog,
    itineraryRows,
    allCabinRows: cabinsResult.data || [],
    importRows: importsResult.data || [],
    cabinImageRows: cabinImagesResult.data || [],
  };
}

async function loadHotelDetail(id, includeMedia) {
  if (id.startsWith('hotel-code-')) {
    const source = await loadPublicCatalog('hotel', decodeURIComponent(id.slice('hotel-code-'.length)));
    return { notFound: false, source };
  }
  const [hotelResult, detailsResult, pricesResult, imagesResult] = await Promise.all([
    supabase.from('catalog_products_v2').select('id,name_ko,description,image_url,metadata,manual_override').eq('id', id).eq('source', 'sht-platform').eq('service_type', 'hotel').eq('is_active', true).maybeSingle(),
    supabase.from('catalog_product_details_v2').select('source_id,payload').eq('product_id', id).eq('source', 'sht-platform').eq('source_table', 'hotel_price').eq('is_active', true),
    supabase.from('catalog_prices_v2').select('source_id,label,price_amount,currency,price_unit,max_guests,valid_from,valid_to').eq('product_id', id).eq('source', 'sht-platform').eq('source_table', 'hotel_price').eq('is_active', true),
    includeMedia
      ? supabase.from('hotel_gallery_images_v2').select('id,hotel_price_code,collection,image_name,image_url,sort_order,is_primary').eq('product_id', id).order('is_primary', { ascending: false }).order('sort_order')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (hotelResult.error || detailsResult.error || pricesResult.error || imagesResult.error) {
    throw detailError(hotelResult.error?.message || detailsResult.error?.message || pricesResult.error?.message || imagesResult.error?.message);
  }
  if (!hotelResult.data) return { notFound: true };
  return {
    notFound: false,
    hotel: hotelResult.data,
    details: detailsResult.data || [],
    prices: pricesResult.data || [],
    images: imagesResult.data || [],
  };
}

async function loadPublicProductDetail(service, id, includeMedia) {
  return service === 'cruise' ? loadCruiseDetail(id, includeMedia) : loadHotelDetail(id, includeMedia);
}

const getCachedPublicProductDetail = unstable_cache(
  loadPublicProductDetail,
  ['public-product-detail-v3'],
  { revalidate: 30, tags: ['public-product-detail'] },
);

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const service = params.get('service');
  const id = params.get('id')?.trim() || '';
  const includeMedia = params.get('includeMedia') === '1';
  if (!['cruise', 'hotel'].includes(service) || !id || id.length > 200) {
    return Response.json({ error: '상품 정보를 확인할 수 없습니다.' }, { status: 400 });
  }

  try {
    const detail = await getCachedPublicProductDetail(service, id, includeMedia);
    return Response.json(detail, {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[public-product-detail] lookup failed', error?.message || error);
    return Response.json({ error: error?.publicMessage || '상품 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
