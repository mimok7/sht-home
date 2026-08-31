// OnePay 결제 결과를 같은 결제 묶음의 플랫폼 원장에 반영한다.
import { getPlatformServiceDatabase } from '@/lib/homepage-booking-cart-server';

export async function recordOnepayResult(paymentId, success, raw) {
  const platform = getPlatformServiceDatabase();
  if (!platform || !paymentId) return false;
  const payment = await platform.from('reservation_payment').select('id,memo').eq('id', paymentId).eq('gateway', 'onepay').maybeSingle();
  if (payment.error || !payment.data?.memo?.startsWith('homepage-onepay:')) return false;
  const status = success ? 'completed' : 'failed';
  const update = { payment_status: status, transaction_id: raw.vpc_TransactionNo || null, raw_response: raw, updated_at: new Date().toISOString() };
  const payments = await platform.from('reservation_payment').update(update).eq('memo', payment.data.memo).eq('gateway', 'onepay').select('reservation_id');
  if (payments.error) return false;
  if (success && payments.data?.length) await platform.from('reservation').update({ payment_status: 'completed', updated_at: new Date().toISOString() }).in('re_id', payments.data.map((item) => item.reservation_id));
  return true;
}