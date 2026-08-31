// 고객 소유 예약의 OnePay 결제 요청을 생성한다.
import crypto from 'crypto';
import { getPlatformCartOwner, getPlatformServiceDatabase } from '@/lib/homepage-booking-cart-server';
import { bookingBaseUrl, buildOnepayUrl, getOnepayConfig } from '@/lib/onepay';

export const runtime = 'nodejs';

function fail(error, status) {
  return Response.json({ error }, { status });
}

export async function POST(request) {
  const owner = await getPlatformCartOwner(request);
  const platform = getPlatformServiceDatabase();
  const config = getOnepayConfig();
  if (!owner) return fail('로그인이 필요합니다.', 401);
  if (!platform) return fail('플랫폼 결제 서버 설정이 없습니다.', 503);
  if (!config) return fail('OnePay 결제 설정이 없습니다.', 503);

  const body = await request.json().catch(() => null);
  const reservationIds = [...new Set(Array.isArray(body?.reservationIds) ? body.reservationIds.filter((id) => typeof id === 'string') : [])];
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!reservationIds.length || reservationIds.length > 20 || !idempotencyKey || idempotencyKey.length > 100) return fail('결제할 예약 정보를 확인해 주세요.', 400);

  const marker = `homepage-onepay:${owner.id}:${idempotencyKey}`;
  const existing = await platform.from('reservation_payment').select('id,reservation_id,amount,payment_status').eq('memo', marker).eq('gateway', 'onepay');
  if (existing.error) return fail('기존 결제 정보를 확인하지 못했습니다.', 500);
  let payments = existing.data || [];

  if (!payments.length) {
    const reservations = await platform.from('reservation').select('re_id,re_user_id,total_amount,payment_status').in('re_id', reservationIds).eq('re_user_id', owner.id);
    if (reservations.error) return fail('예약 정보를 확인하지 못했습니다.', 500);
    if ((reservations.data || []).length !== reservationIds.length) return fail('결제 권한이 없는 예약이 포함되어 있습니다.', 403);
    if ((reservations.data || []).some((reservation) => ['completed', 'paid'].includes(String(reservation.payment_status || '').toLowerCase()) || Number(reservation.total_amount) <= 0)) return fail('이미 결제되었거나 결제할 수 없는 예약이 포함되어 있습니다.', 409);
    const created = await platform.from('reservation_payment').insert(reservations.data.map((reservation) => ({ reservation_id: reservation.re_id, user_id: owner.id, amount: Math.round(Number(reservation.total_amount)), payment_method: 'CARD', payment_status: 'pending', memo: marker, gateway: 'onepay' }))).select('id,reservation_id,amount,payment_status');
    if (created.error) return fail('결제 대기 정보를 만들지 못했습니다.', 500);
    payments = created.data || [];
  }

  if (payments.some((payment) => payment.payment_status === 'completed')) return fail('이미 완료된 결제입니다.', 409);
  const amount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (amount <= 0) return fail('결제 금액을 확인해 주세요.', 400);
  const baseUrl = bookingBaseUrl(request.nextUrl.origin);
  const url = buildOnepayUrl(config, { amount, paymentId: payments[0].id, returnUrl: `${baseUrl}/api/payments/onepay/return`, notifyUrl: `${baseUrl}/api/payments/onepay/notify` });
  return Response.json({ url, paymentId: payments[0].id, amount });
}