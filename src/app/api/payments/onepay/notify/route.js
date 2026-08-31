// OnePay 서버 알림을 검증하고 결제 상태를 반영한다.
import { getOnepayConfig, verifyOnepayHash } from '@/lib/onepay';
import { recordOnepayResult } from '../callback';

export const runtime = 'nodejs';

export async function GET(request) {
  const config = getOnepayConfig();
  if (!config) return Response.json({ success: false, error: '결제 설정이 없습니다.' }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const paymentId = params.get('vpc_MerchTxnRef') || params.get('vpc_MerchantTxnRef') || '';
  if (!verifyOnepayHash(params, config.secureSecret)) return Response.json({ success: false, error: '서명 검증에 실패했습니다.' }, { status: 400 });
  const saved = await recordOnepayResult(paymentId, params.get('vpc_TxnResponseCode') === '0', Object.fromEntries(params.entries()));
  return Response.json({ success: saved });
}