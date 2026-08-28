import { NextResponse } from 'next/server';

const LEGACY_HOME_HOSTS = new Set(['stayhalong.com', 'www.stayhalong.com']);

export function proxy(request) {
  const host = request.headers.get('host')?.split(':')[0].toLowerCase();

  if (host && LEGACY_HOME_HOSTS.has(host)) {
    const url = request.nextUrl.clone();
    url.pathname = '/home';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
