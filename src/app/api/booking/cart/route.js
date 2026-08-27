import { normalizeBookingCartItems } from '@/lib/booking-cart-contract';
import { getHomepageBookingCartDatabase, getPlatformCartOwner } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requestContext(request) {
  const owner = await getPlatformCartOwner(request);
  if (!owner) return { error: Response.json({ error: '플랫폼 로그인이 필요합니다.' }, { status: 401 }) };

  const database = getHomepageBookingCartDatabase();
  if (!database) return { error: Response.json({ error: '홈페이지 장바구니 저장소가 설정되지 않았습니다.' }, { status: 503 }) };
  return { owner, database };
}

export async function GET(request) {
  const context = await requestContext(request);
  if (context.error) return context.error;

  const { data, error } = await context.database
    .from('homepage_booking_carts')
    .select('items,item_count,status,updated_at')
    .eq('platform_user_id', context.owner.id)
    .maybeSingle();

  if (error) {
    console.error('[booking-cart] read failed', error.message);
    return Response.json({ error: '장바구니를 불러오지 못했습니다.' }, { status: 500 });
  }
  return Response.json({ items: normalizeBookingCartItems(data?.items), itemCount: data?.item_count || 0, status: data?.status || 'active', updatedAt: data?.updated_at || null });
}

export async function PUT(request) {
  const context = await requestContext(request);
  if (context.error) return context.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }
  if (!Array.isArray(body?.items)) return Response.json({ error: '장바구니 항목 배열이 필요합니다.' }, { status: 400 });

  const items = normalizeBookingCartItems(body.items);
  if (JSON.stringify(items).length > 64000) return Response.json({ error: '장바구니 데이터가 너무 큽니다.' }, { status: 413 });

  const updatedAt = new Date().toISOString();
  const { data, error } = await context.database
    .from('homepage_booking_carts')
    .upsert({ platform_user_id: context.owner.id, items, item_count: items.length, status: 'active', updated_at: updatedAt }, { onConflict: 'platform_user_id' })
    .select('items,item_count,status,updated_at')
    .single();

  if (error) {
    console.error('[booking-cart] write failed', error.message);
    return Response.json({ error: '장바구니를 저장하지 못했습니다.' }, { status: 500 });
  }
  return Response.json({ items: normalizeBookingCartItems(data.items), itemCount: data.item_count, status: data.status, updatedAt: data.updated_at });
}
