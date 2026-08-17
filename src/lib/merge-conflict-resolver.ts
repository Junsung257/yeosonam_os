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
  void supabaseAdmin;
  throw new Error('LEGACY_PACKAGE_MERGE_MUTATION_RETIRED_USE_CATALOG_IDENTITY_QUARANTINE');
}
