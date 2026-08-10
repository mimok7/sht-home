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

function getHomepageAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function getHomepageDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

// 홈페이지 전용 운영자는 홈페이지 Auth의 서버가 부여한 app_metadata 역할을
// 사용한다. 플랫폼 운영자는 기존 플랫폼 users.role 검증을 유지한다.
export async function getHomepageOperator(request) {
  const token = getBearerToken(request);
  const homepageConfig = getHomepageAuthConfig();
  if (!token) return null;

  if (homepageConfig) {
    const homepage = createClient(homepageConfig.url, homepageConfig.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: homepageAuth } = await homepage.auth.getUser(token);
    const homepageRole = homepageAuth.user?.app_metadata?.role || '';
    if (OPERATOR_ROLES.has(homepageRole)) return { id: homepageAuth.user.id, role: homepageRole };
  }

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
  return OPERATOR_ROLES.has(role) ? { id: authData.user.id, role } : null;
}
