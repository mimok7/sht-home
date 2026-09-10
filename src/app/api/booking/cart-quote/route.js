import { normalizeBookingCartItems } from '@/lib/booking-cart-contract';
import { getBookingCartDatabase, getPlatformCartOwner } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function recipientLabel(value) {
  const name = text(value, 160);
  return name ? (name.endsWith('고객님') ? name : `${name} 고객님`) : '고객님';
}

function quoteNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `SHT-Q-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function totalsFor(items) {
  return items.reduce((totals, item) => {
    const total = Number(item.unitPrice) * Number(item.quantity);
    if (Number.isFinite(total) && total > 0) totals[item.currency] = (totals[item.currency] || 0) + total;
    return totals;
  }, {});
}

export async function POST(request) {
  const owner = await getPlatformCartOwner(request);
  if (!owner) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const database = getBookingCartDatabase();
  if (!database) return Response.json({ error: '견적서 저장 설정을 확인하지 못했습니다.' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '견적서 정보가 올바르지 않습니다.' }, { status: 400 });
  }

  const recipientName = recipientLabel(body?.recipientName);
  const memo = text(body?.memo, 1000);
  const cart = await database.from('homepage_booking_carts').select('items').eq('platform_user_id', owner.id).maybeSingle();
  if (cart.error) {
    console.error('[cart-quote] cart read failed', cart.error.message);
    return Response.json({ error: '장바구니를 확인하지 못했습니다.' }, { status: 500 });
  }

  const items = normalizeBookingCartItems(cart.data?.items);
  if (!items.length) return Response.json({ error: '장바구니에 담긴 상품이 없습니다.' }, { status: 400 });

  const issuedAt = new Date().toISOString();
  const result = await database.from('homepage_cart_quotes').insert({
    quote_number: quoteNumber(), platform_user_id: owner.id, recipient_name: recipientName, memo, items,
    totals: totalsFor(items), item_count: items.length, issued_at: issuedAt,
  }).select('id,quote_number,issued_at').single();
  if (result.error) {
    console.error('[cart-quote] create failed', result.error.message);
    return Response.json({ error: '견적서를 저장하지 못했습니다.' }, { status: 500 });
  }

  return Response.json({ id: result.data.id, quoteNumber: result.data.quote_number, issuedAt: result.data.issued_at });
}
