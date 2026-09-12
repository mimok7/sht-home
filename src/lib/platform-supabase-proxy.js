import { NextResponse } from 'next/server';
import { createPlatformServerClient } from './platform-supabase-server';

export async function updatePlatformAuthSession(request) {
  let response = NextResponse.next({ request });
  const supabase = createPlatformServerClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  });

  if (!supabase) return { response, claims: null };

  const { data } = await supabase.auth.getClaims();
  return { response, claims: data?.claims || null };
}
