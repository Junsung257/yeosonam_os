import { NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { getDashboardStats, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const { data, error } = await supabaseAdmin.rpc('get_admin_dashboard_stats');
  const stats = error ? await getDashboardStats() : data;
  return NextResponse.json({ stats }, { headers: cacheHeader(60) });
}
