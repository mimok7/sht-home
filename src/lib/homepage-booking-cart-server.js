import { createClient } from '@supabase/supabase-js';

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function platformConfig() {
  const url = process.env.PLATFORM_SUPABASE_URL || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = process.env.PLATFORM_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function getHomepageBookingCartDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

export async function getPlatformCartOwner(request) {
  const token = bearerToken(request);
  const config = platformConfig();
  if (!token || !config) return null;

  const platform = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await platform.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email || '' };
}
