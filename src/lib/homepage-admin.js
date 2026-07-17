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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

// 플랫폼의 users.role만 운영 권한 판단에 사용한다. 브라우저가 바꿀 수 있는
// user_metadata는 권한 판단에 절대 사용하지 않는다.
export async function getHomepageOperator(request) {
  const token = getBearerToken(request);
  const config = getPlatformConfig();
  if (!token || !config) return null;

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
