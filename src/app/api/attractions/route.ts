import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/attractions — 전체 관광지 목록 (A4 렌더링용 캐시)
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ attractions: [] });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('name, short_desc, category, emoji, country, region')
      .order('mention_count', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ attractions: data || [] });
  } catch (error) {
    console.error('[Attractions API] 조회 오류:', error);
    return NextResponse.json({ attractions: [] });
  }
}
