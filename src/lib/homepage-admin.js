import { createClient } from '@supabase/supabase-js';

const OPERATOR_ROLES = new Set(['admin', 'manager']);

function getBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function getPlatformConfig() {
  const url = process.env.PLATFORM_SUPABASE_URL || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = process.env.PLATFORM_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function getHomepageDatabase() {
  const url = process.env.PLATFORM_SUPABASE_URL || process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
  const key = process.env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

// Customer APIs verify the platform access token server-side before using the
// service role client. This keeps private reservation documents out of public
// storage URLs and avoids trusting a browser-provided user id.
export async function getHomepageUser(request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const config = getPlatformConfig();
  if (!config) return null;
  const verifier = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await verifier.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

// 인증과 운영자 권한은 플랫폼에서만 검증한다. 이전 홈페이지 JWT는 허용하지 않는다.
export async function getHomepageOperator(request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const config = getPlatformConfig();
  if (!config) return null;

  const verifier = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await verifier.auth.getUser(token);
  if (authError || !authData.user) return null;

  const platform = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: profile, error: profileError } = await platform
    .from('users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError) return null;

  const role = profile?.role || authData.user.app_metadata?.role || '';
  return OPERATOR_ROLES.has(role) ? { id: authData.user.id, email: authData.user.email || '', role } : null;
}
