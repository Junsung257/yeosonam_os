/**
 * GET /api/unmatched/suggest?id=<unmatched_id>
 *
 * 미매칭 활동에 대해 attractions 테이블에서 유사 후보 top-3 추천.
 * 사장님 1클릭 alias 적립 → compound improvement 의 핵심.
 *
 * 매칭 알고리즘 (Senzing/Tamr ER 영감, embedding 없이 가성비):
 *   1. activity 클린 (▶ ※ ☆ 마커 제거 + 괄호·쉼표 제거)
 *   2. 같은 region OR country 의 attractions 만 후보 (오매칭 차단)
 *   3. 각 후보에 대해 score 계산 (name + aliases 모두):
 *      - exact substring contains: 100점
 *      - 토큰 Jaccard: token 교집합/합집합 × 70
 *      - 연속 부분일치 (LCS prefix): max(LCS / min(len)) × 50
 *      - alias 매칭 시 가중치 +10
 *   4. score >= 30 인 후보만 top-3
 *
 * P2 확장 예정: pgvector + sentence-transformer 임베딩 (의미 매칭)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';

// ═══════════════════════════════════════════════════════════════════════════
//  GET handler
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ suggestions: [] });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    // 1. 미매칭 항목 조회
    const { data: unmatched, error: e1 } = await supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, region, country')
      .eq('id', id)
      .single();
    if (e1 || !unmatched) return NextResponse.json({ error: '미매칭 항목 조회 실패' }, { status: 404 });

    // 2. 후보 attractions 조회 — region OR country 필터 (없으면 전체)
    let query = supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc');
    if (unmatched.region) {
      query = query.or(`region.eq.${unmatched.region},country.eq.${unmatched.country || unmatched.region}`);
    } else if (unmatched.country) {
      query = query.eq('country', unmatched.country);
    }

    const { data: candidates, error: e2 } = await query.limit(500);
    if (e2) throw e2;

    const scored = suggestAttractionsForActivity(
      unmatched.activity,
      ((candidates || []) as AttractionSuggestRow[]),
      30,
      3,
    );

    return NextResponse.json({
      activity: unmatched.activity,
      activity_clean: scored.activity_clean,
      candidate_count: candidates?.length || 0,
      suggestions: scored.suggestions,
    });
  } catch (error) {
    console.error('[/api/unmatched/suggest] 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '추천 실패' }, { status: 500 });
  }
}
