import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase.from('cruise_info').select('*').limit(3);
  return NextResponse.json({ data, error });
}
