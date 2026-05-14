/**
 * @file classification-signals.ts — keyword → category 4-way SSOT (2026-05-14 박제)
 *
 * 등록할수록 SSOT 가 풍부해지는 compound learning 시스템.
 *   - context-aware-parser 가 분류한 결과를 누적 (source='local')
 *   - 외부 MRT/Wikidata 검색 결과 누적 (source='mrt'/'wikidata')
 *   - 사장님 정정 시 manual override (is_manual_override=true)
 *
 * lookup 우선순위:
 *   manual_override > destination 매칭 + 가장 빈도 높은 > 전역 majority
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { ItemCategory } from './section-aware-parser';

function normalizeKeyword(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[()（）\[\],.·•・]/g, '');
}

export interface SignalLookupResult {
  category: ItemCategory;
  confidence: number;
  source: string;
  occurrence_count: number;
}

/**
 * 키워드로 분류 신호 조회. destination 컨텍스트 우선.
 * MISS 면 null 반환 → 호출 측에서 context/keyword fallback.
 */
export async function lookupSignal(
  keyword: string,
  destination?: string | null,
): Promise<SignalLookupResult | null> {
  if (!isSupabaseConfigured || !keyword) return null;
  const norm = normalizeKeyword(keyword);
  if (norm.length < 2) return null;

  try {
    // 1) manual override (사장님 정정) 우선
    const { data: manual } = await supabaseAdmin
      .from('classification_signals')
      .select('category, confidence, source, occurrence_count')
      .eq('keyword_norm', norm)
      .eq('is_manual_override', true)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (manual) return manual as SignalLookupResult;

    // 2) destination 매칭 + 가장 빈도 높은
    if (destination) {
      const { data: destMatch } = await supabaseAdmin
        .from('classification_signals')
        .select('category, confidence, source, occurrence_count')
        .eq('keyword_norm', norm)
        .eq('destination', destination)
        .order('occurrence_count', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (destMatch) return destMatch as SignalLookupResult;
    }

    // 3) 전역 majority
    const { data: global } = await supabaseAdmin
      .from('classification_signals')
      .select('category, confidence, source, occurrence_count')
      .eq('keyword_norm', norm)
      .order('occurrence_count', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (global as SignalLookupResult) ?? null;
  } catch {
    return null;
  }
}

/**
 * 새 분류 신호 누적 (compound learning).
 * fire-and-forget — 호출 측은 await 안 함.
 */
export async function recordSignal(args: {
  keyword: string;
  category: ItemCategory;
  destination?: string | null;
  product_type?: string | null;
  source?: string;
  source_url?: string | null;
  confidence?: number;
  manual?: boolean;
}): Promise<void> {
  if (!isSupabaseConfigured || !args.keyword) return;
  const norm = normalizeKeyword(args.keyword);
  if (norm.length < 2) return;

  try {
    const { data: existing } = await supabaseAdmin
      .from('classification_signals')
      .select('id, occurrence_count, confidence, is_manual_override')
      .eq('keyword_norm', norm)
      .eq('destination', args.destination ?? null)
      .eq('category', args.category)
      .maybeSingle();

    if (existing) {
      const row = existing as { id: number; occurrence_count: number; confidence: number; is_manual_override: boolean };
      // manual override 가 이미 있으면 건드리지 않음
      if (row.is_manual_override && !args.manual) return;
      await supabaseAdmin
        .from('classification_signals')
        .update({
          occurrence_count: row.occurrence_count + 1,
          confidence: Math.min(0.99, (row.confidence + (args.confidence ?? 0.7)) / 2),
          last_seen_at: new Date().toISOString(),
          is_manual_override: args.manual || row.is_manual_override,
        })
        .eq('id', row.id)
        .then(undefined, () => {});
    } else {
      await supabaseAdmin
        .from('classification_signals')
        .insert({
          keyword: args.keyword,
          keyword_norm: norm,
          category: args.category,
          destination: args.destination ?? null,
          product_type: args.product_type ?? null,
          source: args.source ?? 'local',
          source_url: args.source_url ?? null,
          confidence: args.confidence ?? 0.7,
          is_manual_override: !!args.manual,
        })
        .then(undefined, () => {});
    }
  } catch {
    /* swallow */
  }
}
