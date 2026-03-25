import { NextResponse } from 'next/server';
import { getDashboardStats, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const stats = await getDashboardStats();
  return NextResponse.json({ stats });
}
