import { NextResponse } from 'next/server';
import { getDashboardStatsV3, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const data = await getDashboardStatsV3(6);
  return NextResponse.json({ data });
}
