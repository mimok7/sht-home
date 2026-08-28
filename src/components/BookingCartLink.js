'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BOOKING_CART_EVENT, hydrateBookingCart, readBookingCart } from '@/lib/booking-cart';
import { platformSupabase } from '@/lib/platform-supabase';

export default function BookingCartLink({ mobile = false, className = '', showCount = true, header = true, children = '장바구니' }) {
  const [count, setCount] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    const updateAuthentication = async () => {
      const { data, error } = await platformSupabase.auth.getUser();
      if (active) setIsAuthenticated(!error && Boolean(data.user));
    };

    void updateAuthentication();
    const { data: listener } = platformSupabase.auth.onAuthStateChange((_event, session) => {
      if (active) setIsAuthenticated(Boolean(session?.user));
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
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
  }, [isAuthenticated]);

  if (!isAuthenticated) return null;
  const cartClassName = [header && (mobile ? 'header-cart mobile' : 'header-cart'), className].filter(Boolean).join(' ');
  return <Link href="/booking/cart" className={cartClassName}>{children}{showCount && <> <b>{count}</b></>}</Link>;
}
