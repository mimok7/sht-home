import { createClient } from '@supabase/supabase-js';

// The booking platform is the single authority for customer identity. Keep this
// client separate from the homepage v2-data client in ./supabase.js: the two
// Supabase projects intentionally have different databases.
const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const platformAnonKey = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;

if (!platformUrl || !platformAnonKey) {
  console.warn(
    'Platform Auth is not configured. Set NEXT_PUBLIC_PLATFORM_SUPABASE_URL and NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY.'
  );
}

export const platformSupabase = createClient(
  platformUrl || 'https://placeholder.supabase.co',
  platformAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'stayhalong-platform-auth',
    },
  }
);
