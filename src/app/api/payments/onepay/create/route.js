// Native payment issuance stays closed until the transaction contract is verified.
import { getPlatformCartOwner } from '@/lib/homepage-booking-cart-server';

export const runtime = 'nodejs';

export async function POST(request) {
  const owner = await getPlatformCartOwner(request);
  if (!owner) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  return Response.json({ error: '예약 담당자가 최종 금액 확인 후 결제 링크를 안내합니다.', code: 'MANAGER_PAYMENT_REQUIRED' }, { status: 409 });
}
