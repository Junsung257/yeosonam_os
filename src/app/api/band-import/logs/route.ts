import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ logs: [] });

  const { data, error } = await supabaseAdmin
    .from('band_import_log')
    .select('id, post_url, post_title, status, imported_at, product_id')
    .order('imported_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}
