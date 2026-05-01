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

interface AttractionRow {
  id: string;
  name: string;
  aliases: string[] | null;
  region: string | null;
  country: string | null;
  category: string | null;
  emoji: string | null;
  short_desc: string | null;
}

interface Suggestion {
  id: string;
  name: string;
  aliases: string[];
  region: string | null;
  country: string | null;
  category: string | null;
  emoji: string | null;
  short_desc: string | null;
  score: number;
  matched_via: 'exact' | 'jaccard' | 'lcs' | 'alias';
  matched_term: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Activity 클린 (마커 / 괄호 부연 제거)
// ═══════════════════════════════════════════════════════════════════════════
function cleanActivity(text: string): string {
  return text
    .replace(/^[▶☆※♣♠♥♦*]+\s*/, '')
    .replace(/[(\[].*?[)\]]/g, ' ')
    .replace(/[·,.\-+/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .filter(t => t.length >= 2)
  );
}

// 한글·영문 LCS prefix length (단순)
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  return i;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Score
// ═══════════════════════════════════════════════════════════════════════════
function scoreCandidate(activityClean: string, activityTokens: Set<string>, attr: AttractionRow): Omit<Suggestion, 'id' | 'name' | 'aliases' | 'region' | 'country' | 'category' | 'emoji' | 'short_desc'> | null {
  const candidates: { term: string; isAlias: boolean }[] = [
    { term: attr.name, isAlias: false },
    ...((attr.aliases || []).map(a => ({ term: a, isAlias: true }))),
  ];

  let best: Omit<Suggestion, 'id' | 'name' | 'aliases' | 'region' | 'country' | 'category' | 'emoji' | 'short_desc'> | null = null;

  for (const { term, isAlias } of candidates) {
    if (!term || term.length < 2) continue;
    const termClean = term.toLowerCase().trim();
    const aliasBonus = isAlias ? 10 : 0;

    // 1. exact substring contains (양방향)
    if (activityClean.includes(termClean) || termClean.includes(activityClean)) {
      const score = 100 + aliasBonus;
      if (!best || score > best.score) {
        best = { score, matched_via: isAlias ? 'alias' : 'exact', matched_term: term };
      }
      continue;
    }

    // 2. 토큰 Jaccard
    const termTokens = tokenize(termClean);
    if (activityTokens.size > 0 && termTokens.size > 0) {
      let intersect = 0;
      for (const t of activityTokens) if (termTokens.has(t)) intersect++;
      const union = activityTokens.size + termTokens.size - intersect;
      const jaccard = union > 0 ? intersect / union : 0;
      if (jaccard >= 0.4) {
        const score = jaccard * 70 + aliasBonus;
        if (!best || score > best.score) {
          best = { score, matched_via: isAlias ? 'alias' : 'jaccard', matched_term: term };
        }
      }
    }

    // 3. 연속 prefix (한글 음절 단위)
    const lcs = commonPrefixLen(activityClean, termClean);
    if (lcs >= 2) {
      const ratio = lcs / Math.min(activityClean.length, termClean.length);
      if (ratio >= 0.5) {
        const score = ratio * 50 + aliasBonus;
        if (!best || score > best.score) {
          best = { score, matched_via: isAlias ? 'alias' : 'lcs', matched_term: term };
        }
      }
    }
  }

  return best;
}

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

    const activityClean = cleanActivity(unmatched.activity);
    const activityTokens = tokenize(activityClean);

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

    // 3. 각 후보 score 계산
    const suggestions: Suggestion[] = [];
    for (const attr of (candidates || []) as AttractionRow[]) {
      const sc = scoreCandidate(activityClean, activityTokens, attr);
      if (sc && sc.score >= 30) {
        suggestions.push({
          id: attr.id,
          name: attr.name,
          aliases: attr.aliases || [],
          region: attr.region,
          country: attr.country,
          category: attr.category,
          emoji: attr.emoji,
          short_desc: attr.short_desc,
          ...sc,
        });
      }
    }

    suggestions.sort((a, b) => b.score - a.score);
    const top = suggestions.slice(0, 3);

    return NextResponse.json({
      activity: unmatched.activity,
      activity_clean: activityClean,
      candidate_count: candidates?.length || 0,
      suggestions: top,
    });
  } catch (error) {
    console.error('[/api/unmatched/suggest] 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '추천 실패' }, { status: 500 });
  }
}
