import { createBrowserClient } from '@supabase/ssr';

// The platform is the sole database, Storage and identity provider.
// ./supabase.js re-exports this client for public catalogue queries as well.
const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const platformAnonKey = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;
const REFRESH_RETRY_DELAY_MS = 60_000;
let refreshInFlight = null;
let refreshRetryAfter = 0;

if (!platformUrl || !platformAnonKey) {
  console.warn(
    'Platform Auth is not configured. Set NEXT_PUBLIC_PLATFORM_SUPABASE_URL and NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY.'
  );
}

export const platformSupabase = createBrowserClient(
  platformUrl || 'https://placeholder.supabase.co',
  platformAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

// Keep one refresh in flight across Header, cart, and admin components. Without
// this guard, a Fast Refresh can turn a single expired session into several
// simultaneous refresh-token requests and trigger Supabase's 429 rate limit.
export async function refreshPlatformSession() {
  if (Date.now() < refreshRetryAfter) return null;
  if (!refreshInFlight) {
    refreshInFlight = platformSupabase.auth.refreshSession()
      .then(({ data, error }) => {
        const session = error ? null : data.session || null;
        refreshRetryAfter = session ? 0 : Date.now() + REFRESH_RETRY_DELAY_MS;
        return session;
      })
      .catch(() => {
        refreshRetryAfter = Date.now() + REFRESH_RETRY_DELAY_MS;
        return null;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
