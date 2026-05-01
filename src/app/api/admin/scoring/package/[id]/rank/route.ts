import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * 특정 패키지의 그룹 내 순위/점수 조회 (어드민 운영 진단용).
 * 가장 최근 캐시된 score 1건 반환.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const { data, error } = await supabaseAdmin
    .from('package_scores')
    .select('*')
    .eq('package_id', params.id)
    .order('computed_at', { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ score: null, message: '점수 없음 (cron 미실행 또는 그룹 단독)' });
  }
  return NextResponse.json({ score: data[0] });
}
