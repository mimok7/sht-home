// 홈페이지 고객 결제용 OnePay 요청과 콜백 서명을 처리한다.
import crypto from 'crypto';

function isHex(value) {
  return /^[0-9a-fA-F]+$/.test(value);
}

function isPlaceholder(value) {
  return !value || /YOUR_|CHANGE_ME/i.test(value);
}

export function getOnepayConfig() {
  const paymentUrl = process.env.ONEPAY_VPC_PAYMENT_URL || '';
  const merchant = process.env.ONEPAY_VPC_MERCHANT || '';
  const accessCode = process.env.ONEPAY_VPC_ACCESS_CODE || '';
  const secureSecret = process.env.ONEPAY_VPC_SECURE_SECRET || '';
  if ([paymentUrl, merchant, accessCode, secureSecret].some(isPlaceholder)) return null;
  return { paymentUrl, merchant, accessCode, secureSecret };
}

function secureHash(params, secureSecret) {
  const payload = Object.keys(params).filter((key) => key.startsWith('vpc_') && key !== 'vpc_SecureHash' && key !== 'vpc_SecureHashType' && params[key] !== '').sort().map((key) => `${key}=${params[key]}`).join('&');
  const key = isHex(secureSecret) ? Buffer.from(secureSecret, 'hex') : secureSecret;
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex').toUpperCase();
}

export function buildOnepayUrl(config, { amount, paymentId, returnUrl, notifyUrl }) {
  const params = { vpc_Version: '2', vpc_Command: 'pay', vpc_AccessCode: config.accessCode, vpc_Merchant: config.merchant, vpc_Locale: 'vn', vpc_ReturnURL: returnUrl, vpc_NotifyURL: notifyUrl, vpc_MerchTxnRef: paymentId, vpc_OrderInfo: `Stay Halong payment ${paymentId}`, vpc_Amount: String(Math.round(amount * 100)), vpc_Currency: 'VND' };
  return `${config.paymentUrl}?${new URLSearchParams({ ...params, vpc_SecureHash: secureHash(params, config.secureSecret), vpc_SecureHashType: 'SHA256' }).toString()}`;
}

export function verifyOnepayHash(searchParams, secureSecret) {
  const params = Object.fromEntries(searchParams.entries());
  const received = params.vpc_SecureHash || '';
  return received.toUpperCase() === secureHash(params, secureSecret).toUpperCase();
}

export function bookingBaseUrl(origin) {
  return (process.env.ONEPAY_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/$/, '');
}