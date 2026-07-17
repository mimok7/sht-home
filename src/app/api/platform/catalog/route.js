import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const CATALOGS = {
  cruise: {
    table: 'cruise_rate_card',
    select: 'id,cruise_name,schedule_type,room_type,room_type_en,currency,price_adult,price_child,price_infant,price_single,valid_from,valid_to,season_name,is_active,updated_at',
    order: 'cruise_name',
  },
  hotel: {
    table: 'hotel_price',
    select: 'hotel_price_code,hotel_code,hotel_name,room_type,room_name,base_price,start_date,end_date,updated_at',
    order: 'hotel_name',
  },
  tour: {
    table: 'tour_pricing',
    select: 'pricing_id,tour_id,min_guests,max_guests,price_per_person,updated_at',
    order: 'tour_id',
  },
  vehicle: {
    table: 'rentcar_price',
    select: 'id,route,vehicle_type,way_type,price,capacity,valid_from,valid_to,updated_at',
    order: 'route',
  },
};

function getPlatformClient() {
  const url = process.env.PLATFORM_SUPABASE_URL || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = process.env.PLATFORM_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request) {
  const service = new URL(request.url).searchParams.get('service') || 'cruise';
  const catalog = CATALOGS[service];
  const platform = getPlatformClient();

  if (!catalog) {
    return Response.json({ error: '지원하지 않는 서비스입니다.' }, { status: 400 });
  }

  if (!platform) {
    return Response.json({ error: '플랫폼 데이터 연결 정보가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { data, error } = await platform
    .from(catalog.table)
    .select(catalog.select)
    .order(catalog.order)
    .limit(1000);

  if (error) {
    // Do not return database internals to visitors. Administrators can inspect
    // the server log and then grant the dedicated platform catalogue view.
    console.error(`[platform catalogue:${service}]`, error.message);
    return Response.json({ error: '플랫폼 상품 데이터를 읽을 수 없습니다.' }, { status: 502 });
  }

  return Response.json({ source: 'sht-platform', service, data: data || [] }, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  });
}
