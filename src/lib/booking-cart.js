import { normalizeBookingCartItem, normalizeBookingCartItems } from './booking-cart-contract';
import { platformSupabase } from './platform-supabase';

export const BOOKING_CART_KEY = 'stayhalong-booking-cart-v1';
export const BOOKING_CART_EVENT = 'stayhalong:booking-cart-change';
const BOOKING_CART_OWNER_KEY = 'stayhalong-booking-cart-owner-v1';

export function readBookingCart() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BOOKING_CART_KEY) || '[]');
    return normalizeBookingCartItems(parsed);
  } catch { return []; }
}

export function writeBookingCart(items) {
  if (typeof window === 'undefined') return [];
  const normalized = normalizeBookingCartItems(items);
  window.localStorage.setItem(BOOKING_CART_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(BOOKING_CART_EVENT, { detail: normalized }));
  return normalized;
}

export function addBookingCartItem(item) {
  const nextItem = normalizeBookingCartItem(item);
  if (!nextItem) throw new Error('장바구니 상품 정보가 올바르지 않습니다.');
  const current = readBookingCart();
  const next = [...current.filter((entry) => entry.id !== nextItem.id), nextItem];
  writeBookingCart(next);
  void syncBookingCart(next).catch(() => {});
  return nextItem;
}

export function removeBookingCartItem(id) {
  const next = writeBookingCart(readBookingCart().filter((item) => item.id !== id));
  void syncBookingCart(next).catch(() => {});
  return next;
}

export function bookingCartTotal(items, currency = 'VND') {
  return items.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

function mergeCartItems(first, second) {
  const byId = new Map();
  for (const item of [...first, ...second]) {
    const existing = byId.get(item.id);
    if (!existing || Date.parse(item.addedAt) >= Date.parse(existing.addedAt)) byId.set(item.id, item);
  }
  return normalizeBookingCartItems([...byId.values()]);
}

async function platformSession() {
  const { data } = await platformSupabase.auth.getSession();
  return data.session || null;
}

export async function syncBookingCart(items = readBookingCart()) {
  if (typeof window === 'undefined') return { synced: false };
  const session = await platformSession();
  if (!session) return { synced: false };

  const owner = window.localStorage.getItem(BOOKING_CART_OWNER_KEY);
  if (owner && owner !== session.user.id) return { synced: false, ownerChanged: true };
  window.localStorage.setItem(BOOKING_CART_OWNER_KEY, session.user.id);

  const response = await fetch('/api/booking/cart', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ items: normalizeBookingCartItems(items) }),
  });
  if (!response.ok) throw new Error('장바구니를 홈페이지 DB에 저장하지 못했습니다.');
  const data = await response.json();
  return { synced: true, items: normalizeBookingCartItems(data.items) };
}

export async function hydrateBookingCart() {
  if (typeof window === 'undefined') return { items: [], synced: false };
  const localItems = readBookingCart();
  const session = await platformSession();
  if (!session) return { items: localItems, synced: false };

  const storedOwner = window.localStorage.getItem(BOOKING_CART_OWNER_KEY);
  const canMigrateLocalItems = !storedOwner || storedOwner === session.user.id;
  const response = await fetch('/api/booking/cart', { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) return { items: localItems, synced: false, error: '저장된 장바구니를 불러오지 못했습니다.' };

  const remote = await response.json();
  const items = mergeCartItems(normalizeBookingCartItems(remote.items), canMigrateLocalItems ? localItems : []);
  window.localStorage.setItem(BOOKING_CART_OWNER_KEY, session.user.id);
  writeBookingCart(items);

  if (JSON.stringify(items) !== JSON.stringify(normalizeBookingCartItems(remote.items))) {
    try { await syncBookingCart(items); } catch { return { items, synced: false, error: '장바구니를 동기화하지 못했습니다.' }; }
  }
  return { items, synced: true, updatedAt: remote.updatedAt || null };
}
