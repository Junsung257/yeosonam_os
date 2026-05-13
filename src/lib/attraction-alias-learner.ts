/**
 * @file attraction-alias-learner.ts — P11-2 attractions alias 자동 학습 (LLM 0)
 *
 * 박제 사유 (2026-05-13):
 * 사장님이 검수 큐에서 "타이페이101 → 타이베이101" 같은 표기 정정 → attractions_aliases
 * 자동 INSERT → 다음 등록 시 fuzzy matcher가 alias 매칭 → 동일 attraction 인식.
 *
 * 흐름:
 *   1. recordAlias(canonical, alias, destination) — 정정 누적 (UPSERT, occurrence_count++)
 *   2. lookupAliases(canonical) — fuzzy matcher 가 alias 후보 조회
 *   3. suggestCanonicalForAlias(alias) — 입력 텍스트가 alias 면 canonical 으로 정규화
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface AttractionAlias {
  id: number;
  canonical_name: string;
  alias: string;
  destination: string | null;
  confidence: number;
  source: 'manual' | 'reflexion' | 'llm_suggest';
  occurrence_count: number;
  last_used_at: string;
}

/** alias 누적 — 사장님 정정 시 자동 호출 */
export async function recordAlias(args: {
  canonical_name: string;
  alias: string;
  destination?: string | null;
  source?: 'manual' | 'reflexion' | 'llm_suggest';
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (!args.canonical_name || !args.alias) return;
  if (args.canonical_name === args.alias) return;

  try {
    // UPSERT: 기존 row 있으면 occurrence_count + 1, 없으면 INSERT
    const { data: existing } = await supabaseAdmin
      .from('attractions_aliases')
      .select('id, occurrence_count')
      .eq('canonical_name', args.canonical_name)
      .eq('alias', args.alias)
      .maybeSingle();

    if (existing) {
      const row = existing as { id: number; occurrence_count: number };
      await supabaseAdmin
        .from('attractions_aliases')
        .update({
          occurrence_count: row.occurrence_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } else {
      await supabaseAdmin
        .from('attractions_aliases')
        .insert({
          canonical_name: args.canonical_name,
          alias:          args.alias,
          destination:    args.destination ?? null,
          source:         args.source ?? 'manual',
          confidence:     0.85,
        });
    }
  } catch (e) {
    console.warn('[alias-learner] recordAlias 실패:', (e as Error).message);
  }
}

/** canonical_name 의 모든 alias 조회 (fuzzy matcher 호출용) */
export async function lookupAliases(canonical_name: string, destination?: string | null): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  try {
    let query = supabaseAdmin
      .from('attractions_aliases')
      .select('alias, occurrence_count')
      .eq('canonical_name', canonical_name)
      .order('occurrence_count', { ascending: false })
      .limit(10);
    if (destination) query = query.or(`destination.eq.${destination},destination.is.null`);
    const { data } = await query;
    return ((data ?? []) as Array<{ alias: string }>).map(r => r.alias);
  } catch {
    return [];
  }
}

/** alias 가 canonical_name 인 row 역 lookup */
export async function suggestCanonicalForAlias(alias: string): Promise<{ canonical_name: string; confidence: number } | null> {
  if (!isSupabaseConfigured || !alias) return null;
  try {
    const { data } = await supabaseAdmin
      .from('attractions_aliases')
      .select('canonical_name, confidence, occurrence_count')
      .eq('alias', alias)
      .order('occurrence_count', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { canonical_name: string; confidence: number };
    return { canonical_name: row.canonical_name, confidence: row.confidence };
  } catch {
    return null;
  }
}

/** 통계 — 어드민 페이지에서 활용 */
export async function getAliasStats(): Promise<{ total: number; by_source: Record<string, number>; top_canonicals: Array<{ name: string; alias_count: number }> }> {
  if (!isSupabaseConfigured) return { total: 0, by_source: {}, top_canonicals: [] };
  try {
    const { data: all } = await supabaseAdmin
      .from('attractions_aliases')
      .select('canonical_name, source');
    const rows = (all ?? []) as Array<{ canonical_name: string; source: string }>;
    const by_source: Record<string, number> = {};
    const canonicalCount = new Map<string, number>();
    for (const r of rows) {
      by_source[r.source] = (by_source[r.source] ?? 0) + 1;
      canonicalCount.set(r.canonical_name, (canonicalCount.get(r.canonical_name) ?? 0) + 1);
    }
    const top_canonicals = Array.from(canonicalCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, alias_count]) => ({ name, alias_count }));
    return { total: rows.length, by_source, top_canonicals };
  } catch {
    return { total: 0, by_source: {}, top_canonicals: [] };
  }
}
