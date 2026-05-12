import { NextResponse } from 'next/server';
import { getDashboardStatsV3, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const months = Math.min(24, Math.max(1, parseInt(searchParams.get('months') || '6', 10)));
  const data = await getDashboardStatsV3(months);
  return NextResponse.json({ data });
}
