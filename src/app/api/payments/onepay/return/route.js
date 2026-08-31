// OnePay 고객 복귀 요청을 검증하고 예약 내역으로 안내한다.
import { bookingBaseUrl, getOnepayConfig, verifyOnepayHash } from '@/lib/onepay';
import { recordOnepayResult } from '../callback';

export const runtime = 'nodejs';

export async function GET(request) {
  const config = getOnepayConfig();
  const params = request.nextUrl.searchParams;
  const paymentId = params.get('vpc_MerchTxnRef') || params.get('vpc_MerchantTxnRef') || '';
  const baseUrl = bookingBaseUrl(request.nextUrl.origin);
  if (!config || !verifyOnepayHash(params, config.secureSecret)) return Response.redirect(`${baseUrl}/booking/reservations?payment=invalid`);
  const success = params.get('vpc_TxnResponseCode') === '0';
  await recordOnepayResult(paymentId, success, Object.fromEntries(params.entries()));
  return Response.redirect(`${baseUrl}/booking/reservations?payment=${success ? 'success' : 'failed'}`);
}