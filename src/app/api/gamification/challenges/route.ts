/**
 * 챌린지 API
 *
 * GET /api/gamification/challenges  — 활성 챌린지 목록 + 사용자 참여 정보
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 활성 챌린지 조회 (별도 쿼리)
    const now = new Date().toISOString();
    const { data: challenges } = await supabaseAdmin
      .from('mileage_challenges')
      .select('*')
      .lte('starts_at', now)
      .gte('ends_at', now)
      .order('starts_at', { ascending: false });

    // 사용자 참여 정보 조회
    const challengeIds = (challenges ?? []).map((c: any) => c.id);
    let participationMap = new Map<string, { progress: number; completed: boolean }>();

    if (challengeIds.length > 0) {
      const { data: participation } = await supabaseAdmin
        .from('challenge_participants')
        .select('challenge_id, progress, completed')
        .eq('customer_id', user.id)
        .in('challenge_id', challengeIds);

      for (const p of (participation ?? []) as Array<{ challenge_id: string; progress: number; completed: boolean }>) {
        participationMap.set(p.challenge_id, { progress: p.progress, completed: p.completed });
      }
    }

    const result = (challenges ?? []).map((challenge: Record<string, unknown>) => {
      const id = challenge.id as string;
      const participant = participationMap.get(id);
      return {
        ...challenge,
        is_active: true,
        participant: participant ?? null,
      };
    });

    return NextResponse.json({ challenges: result });
  } catch (error) {
    console.error('[Challenges] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
