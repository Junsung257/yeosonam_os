import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { recomputeAllScores } from '@/lib/scoring/recommend';
import { fitHedonicCoefs } from '@/lib/scoring/hedonic-fit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 어드민 즉시 재계산 — 가중치/시장가 변경 후 미리보기용.
 * 흐름: 1차 점수 → 헤도닉 학습 → 2차 점수.
 */
export async function POST() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const startedAt = Date.now();
  try {
    const first = await recomputeAllScores();
    const hedonic = await fitHedonicCoefs();
    const second = await recomputeAllScores();
    return NextResponse.json({
      ok: true,
      ms: Date.now() - startedAt,
      first: { groups: first.groups, packages: first.packages },
      hedonic: {
        sample_size: hedonic.sample_size,
        computed_from: hedonic.computed_from,
        shopping_per_count: hedonic.shopping_per_count,
        meal_per_count: hedonic.meal_per_count,
        hotel_grade_step: hedonic.hotel_grade_step,
      },
      second: { groups: second.groups, packages: second.packages, version: second.policy_version },
    });
  } catch (e) {
    console.error('[admin/scoring/recompute] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
