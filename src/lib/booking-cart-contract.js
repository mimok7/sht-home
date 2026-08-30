export const BOOKING_CART_MAX_ITEMS = 40;

export const SERVICE_LABELS = {
  cruise: '크루즈', cruise_vehicle: '크루즈 차량', airport: '공항 이동', hotel: '호텔',
  rentcar: '렌터카', tour: '투어', package: '패키지', ticket: '티켓',
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 20000 ? JSON.parse(serialized) : {};
  } catch {
    return {};
  }
}

export function normalizeBookingCartItem(item) {
  if (!item || !SERVICE_LABELS[item.serviceType] || !item.productId || !item.name) return null;
  return {
    id: String(item.id || `${item.serviceType}:${item.productId}:${item.optionId || 'base'}:${item.startDate || 'open'}`).slice(0, 240),
    serviceType: item.serviceType,
    serviceLabel: SERVICE_LABELS[item.serviceType],
    productId: String(item.productId).slice(0, 160),
    optionId: item.optionId ? String(item.optionId).slice(0, 160) : '',
    name: String(item.name).slice(0, 160),
    optionName: String(item.optionName || '').slice(0, 160),
    startDate: String(item.startDate || '').slice(0, 10),
    endDate: String(item.endDate || '').slice(0, 10),
    adults: safeNumber(item.adults), children: safeNumber(item.children), infants: safeNumber(item.infants),
    quantity: Math.max(1, safeNumber(item.quantity, 1)),
    unitPrice: safeNumber(item.unitPrice), currency: ['USD', 'KRW'].includes(item.currency) ? item.currency : 'VND',
    priceStatus: item.priceStatus === 'confirmed' ? 'confirmed' : 'reference',
    sourceHref: String(item.sourceHref || '').startsWith('/') ? String(item.sourceHref).slice(0, 500) : '/booking',
    metadata: safeMetadata(item.metadata),
    addedAt: typeof item.addedAt === 'string' && !Number.isNaN(Date.parse(item.addedAt)) ? item.addedAt : new Date().toISOString(),
  };
}

export function normalizeBookingCartItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map(normalizeBookingCartItem).filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, BOOKING_CART_MAX_ITEMS);
}
