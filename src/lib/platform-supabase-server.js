import { createServerClient } from '@supabase/ssr';

const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const platformAnonKey = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;

export function isPlatformAuthConfigured() {
  return Boolean(platformUrl && platformAnonKey);
}

export function createPlatformServerClient(cookieStore) {
  if (!isPlatformAuthConfigured()) return null;

  return createServerClient(platformUrl, platformAnonKey, {
    cookies: cookieStore,
  });
}
