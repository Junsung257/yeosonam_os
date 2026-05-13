/**
 * @file merge-conflict-resolver.ts — DA-3 데이터 충돌 자동 병합 (P12-5, LLM 0)
 *
 * 박제 사유 (2026-05-13):
 * 같은 상품 중복 등록 시 자동 감지 → 신뢰도 가중 자동 병합/archive 결정.
 *
 * 정책:
 * - normalized_content_hash 매치: 새 행 archive (기존 보존)
 * - title+destination 매치 + confidence delta > 0.05: keep_new (기존 archive)
 * - 그 외: keep_existing
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface MergeDecision {
  action: 'keep_new' | 'keep_existing' | 'merge' | 'no_conflict';
  reason: string;
  existing_id: string | null;
  new_id: string;
  confidence_new: number;
  confidence_existing: number | null;
}

export async function resolveMergeConflict(args: {
  new_id: string;
  new_internal_code: string | null;
  new_title: string;
  new_destination: string | null;
  new_departure_date: string | null;
  new_confidence: number;
  new_leak_score: number | null;
  new_normalized_hash: string | null;
}): Promise<MergeDecision> {
  const baseDecision: MergeDecision = {
    action: 'no_conflict',
    reason: '',
    existing_id: null,
    new_id: args.new_id,
    confidence_new: args.new_confidence,
    confidence_existing: null,
  };

  if (!isSupabaseConfigured) return baseDecision;

  try {
    // 1) normalized_content_hash 매치
    if (args.new_normalized_hash) {
      const { data: hashMatch } = await supabaseAdmin
        .from('travel_packages')
        .select('id, confidence, status')
        .neq('id', args.new_id)
        .eq('normalized_content_hash', args.new_normalized_hash)
        .neq('status', 'archived')
        .limit(1)
        .maybeSingle();

      if (hashMatch) {
        const existing = hashMatch as { id: string; confidence: number | null };
        await supabaseAdmin
          .from('travel_packages')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', args.new_id);
        return {
          ...baseDecision,
          action: 'keep_existing',
          reason: `normalized_hash 매치 — 새 행 자동 archive (기존 ${existing.id})`,
          existing_id: existing.id,
          confidence_existing: existing.confidence ?? 0,
        };
      }
    }

    // 2) title + destination soft 매치
    if (args.new_title && args.new_destination) {
      const { data: softMatch } = await supabaseAdmin
        .from('travel_packages')
        .select('id, confidence, status')
        .neq('id', args.new_id)
        .eq('title', args.new_title)
        .eq('destination', args.new_destination)
        .neq('status', 'archived')
        .limit(1)
        .maybeSingle();

      if (softMatch) {
        const existing = softMatch as { id: string; confidence: number | null };
        const existingConf = existing.confidence ?? 0;
        const delta = args.new_confidence - existingConf;
        if (delta > 0.05) {
          await supabaseAdmin
            .from('travel_packages')
            .update({ status: 'archived', updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          return {
            ...baseDecision,
            action: 'keep_new',
            reason: `soft 매치 — 새 confidence (${args.new_confidence}) > 기존 (${existingConf}) + 0.05`,
            existing_id: existing.id,
            confidence_existing: existingConf,
          };
        }
        await supabaseAdmin
          .from('travel_packages')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', args.new_id);
        return {
          ...baseDecision,
          action: 'keep_existing',
          reason: `soft 매치 — 기존 (${existingConf}) ≥ 새 (${args.new_confidence})`,
          existing_id: existing.id,
          confidence_existing: existingConf,
        };
      }
    }

    return baseDecision;
  } catch (e) {
    console.warn('[merge-conflict-resolver] 실패(무시):', (e as Error).message);
    return baseDecision;
  }
}
