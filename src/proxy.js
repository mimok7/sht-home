import { NextResponse } from 'next/server';

export function proxy(request) {
  const host = request.headers.get('host')?.split(':')[0];

  if (host === 'stayhalong.com' || host === 'www.stayhalong.com') {
    return NextResponse.rewrite(new URL('/temp-home', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
