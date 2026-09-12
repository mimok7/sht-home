import { NextResponse } from 'next/server';
import { updatePlatformAuthSession } from '@/lib/platform-supabase-proxy';

const protectedPrefixes = ['/admin', '/booking/cart', '/booking/checkout', '/booking/reservations'];

function requiresAuthentication(pathname) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function loginRedirect(request, sessionResponse) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const redirect = NextResponse.redirect(loginUrl);
  sessionResponse.cookies.getAll().forEach(({ name, value, ...options }) => redirect.cookies.set(name, value, options));
  return redirect;
}

export async function proxy(request) {
  const { response, claims } = await updatePlatformAuthSession(request);

  if (requiresAuthentication(request.nextUrl.pathname) && !claims?.sub) {
    return loginRedirect(request, response);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/booking/cart/:path*', '/booking/checkout/:path*', '/booking/reservations/:path*'],
};
