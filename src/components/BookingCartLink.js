'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BOOKING_CART_EVENT, hydrateBookingCart, readBookingCart } from '@/lib/booking-cart';

export default function BookingCartLink({ mobile = false }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(readBookingCart().length);
    const refresh = () => { void hydrateBookingCart().then((result) => setCount(result.items.length)).catch(() => {}); };
    queueMicrotask(() => { update(); refresh(); });
    window.addEventListener(BOOKING_CART_EVENT, update);
    window.addEventListener('storage', update);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(BOOKING_CART_EVENT, update);
      window.removeEventListener('storage', update);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return <Link href="/booking/cart" className={mobile ? 'header-cart mobile' : 'header-cart'}>장바구니 <b>{count}</b></Link>;
}
