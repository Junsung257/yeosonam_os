import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from('active_destinations')
    .select('destination, package_count, min_price, avg_rating, total_reviews')
    .order('package_count', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
