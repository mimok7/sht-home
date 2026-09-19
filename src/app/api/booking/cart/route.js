import { normalizeBookingCartItems } from '@/lib/booking-cart-contract';
import { getBookingCartDatabase, getPlatformCartOwner } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requestContext(request) {
  const owner = await getPlatformCartOwner(request);
  if (!owner) return { error: Response.json({ error: '로그인이 필요합니다.' }, { status: 401 }) };

  const database = getBookingCartDatabase();
  if (!database) return { error: Response.json({ error: '장바구니 저장소가 설정되지 않았습니다.' }, { status: 503 }) };
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
  return Response.json({
    exists: Boolean(data),
    items: normalizeBookingCartItems(data?.items),
    itemCount: data?.item_count || 0,
    status: data?.status || 'active',
    updatedAt: data?.updated_at || null,
  });
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
  const current = await context.database.from('homepage_booking_carts').select('id,status,updated_at').eq('platform_user_id', context.owner.id).maybeSingle();
  if (current.error) return Response.json({ error: '장바구니 상태를 확인하지 못했습니다.' }, { status: 500 });
  if (current.data && current.data.status !== 'active') return Response.json({ error: '예약 처리 중인 장바구니는 변경할 수 없습니다. 예약 내역을 확인해 주세요.' }, { status: 409 });
  const values = { items, item_count: items.length, status: 'active', updated_at: updatedAt };
  const query = current.data
    ? context.database.from('homepage_booking_carts').update(values).eq('id', current.data.id).eq('platform_user_id', context.owner.id).eq('status', 'active').eq('updated_at', current.data.updated_at)
    : context.database.from('homepage_booking_carts').insert({ ...values, platform_user_id: context.owner.id });
  const { data, error } = await query.select('items,item_count,status,updated_at').maybeSingle();
  if (!error && !data || error?.code === '23505') return Response.json({ error: '다른 화면에서 장바구니가 변경되었습니다. 다시 확인해 주세요.' }, { status: 409 });

  if (error) {
    console.error('[booking-cart] write failed', error.message);
    return Response.json({ error: '장바구니를 저장하지 못했습니다.' }, { status: 500 });
  }
  return Response.json({ items: normalizeBookingCartItems(data.items), itemCount: data.item_count, status: data.status, updatedAt: data.updated_at });
}
