import { createClient } from '@supabase/supabase-js';

// 고객 로그인과 공개 카탈로그는 운영 중인 플랫폼 프로젝트를 공통으로 사용한다.
const supabaseUrl = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Warning: Platform Supabase URL or Anon Key is missing. Please set NEXT_PUBLIC_PLATFORM_SUPABASE_URL and NEXT_PUBLIC_PLATFORM_SUPABASE_ANON_KEY in your .env.local file.'
  );
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');
