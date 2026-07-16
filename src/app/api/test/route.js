import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('public_cruise_recommendation_v2')
    .select('cruise_id,slug,cruise_name,schedule_type,cabin_id,cabin_name,price_basis,currency,price_adult')
    .limit(3);
  return NextResponse.json({ source: 'v2', data, error });
}
