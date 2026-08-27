'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BOOKING_CART_EVENT, hydrateBookingCart, readBookingCart } from '@/lib/booking-cart';

export default function BookingCartLink({ mobile = false }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(readBookingCart().length);
    queueMicrotask(() => { update(); void hydrateBookingCart().then((result) => setCount(result.items.length)).catch(() => {}); });
    window.addEventListener(BOOKING_CART_EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(BOOKING_CART_EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  return <Link href="/booking/cart" className={mobile ? 'header-cart mobile' : 'header-cart'}>장바구니 <b>{count}</b></Link>;
}
