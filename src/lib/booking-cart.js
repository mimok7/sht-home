export const BOOKING_CART_KEY = 'stayhalong-booking-cart-v1';
export const BOOKING_CART_EVENT = 'stayhalong:booking-cart-change';

const SERVICE_LABELS = {
  cruise: '크루즈', cruise_vehicle: '크루즈 차량', airport: '공항 이동', hotel: '호텔',
  rentcar: '렌터카', tour: '투어', package: '패키지', ticket: '티켓',
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeItem(item) {
  if (!item || !SERVICE_LABELS[item.serviceType] || !item.productId || !item.name) return null;
  return {
    id: String(item.id || `${item.serviceType}:${item.productId}:${item.optionId || 'base'}:${item.startDate || 'open'}`),
    serviceType: item.serviceType,
    serviceLabel: SERVICE_LABELS[item.serviceType],
    productId: String(item.productId),
    optionId: item.optionId ? String(item.optionId) : '',
    name: String(item.name).slice(0, 160),
    optionName: String(item.optionName || '').slice(0, 160),
    startDate: String(item.startDate || '').slice(0, 10),
    endDate: String(item.endDate || '').slice(0, 10),
    adults: safeNumber(item.adults), children: safeNumber(item.children), infants: safeNumber(item.infants),
    quantity: Math.max(1, safeNumber(item.quantity, 1)),
    unitPrice: safeNumber(item.unitPrice), currency: item.currency === 'USD' ? 'USD' : 'VND',
    priceStatus: item.priceStatus === 'confirmed' ? 'confirmed' : 'reference',
    sourceHref: String(item.sourceHref || '').startsWith('/') ? String(item.sourceHref) : '/booking',
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    addedAt: item.addedAt || new Date().toISOString(),
  };
}

export function readBookingCart() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BOOKING_CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeItem).filter(Boolean).slice(0, 40) : [];
  } catch { return []; }
}

export function writeBookingCart(items) {
  if (typeof window === 'undefined') return [];
  const normalized = items.map(normalizeItem).filter(Boolean).slice(0, 40);
  window.localStorage.setItem(BOOKING_CART_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(BOOKING_CART_EVENT, { detail: normalized }));
  return normalized;
}

export function addBookingCartItem(item) {
  const nextItem = normalizeItem(item);
  if (!nextItem) throw new Error('장바구니 상품 정보가 올바르지 않습니다.');
  const current = readBookingCart();
  const next = [...current.filter((entry) => entry.id !== nextItem.id), nextItem];
  writeBookingCart(next);
  return nextItem;
}

export function removeBookingCartItem(id) {
  return writeBookingCart(readBookingCart().filter((item) => item.id !== id));
}

export function bookingCartTotal(items, currency = 'VND') {
  return items.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}
