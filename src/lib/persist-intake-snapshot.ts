/**
 * upload / backfill → normalized_intakes 역변환 스냅샷 (P1 SSOT 브릿지)
 *
 * parseDocument 경로로 저장된 pkg 를 pkgToIntake 로 IR 에 적재해
 * register-via-ir 와 동일 테이블로 수렴한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pkgToIntake } from './pkg-to-ir';

export type IntakeSnapshotSource = 'upload' | 'backfill' | 'ir-register';

export interface PersistIntakeSnapshotInput {
  packageId: string;
  pkg: Parameters<typeof pkgToIntake>[0];
  landOperatorName?: string | null;
  source?: IntakeSnapshotSource;
}

export interface PersistIntakeSnapshotResult {
  intakeId: string | null;
  warnings: string[];
  created: boolean;
}

/** package_id 기준 upsert — upload·backfill 공통 */
export async function persistIntakeSnapshot(
  sb: SupabaseClient,
  input: PersistIntakeSnapshotInput,
): Promise<PersistIntakeSnapshotResult> {
  const { ir, warnings } = pkgToIntake(input.pkg, {
    landOperatorName: input.landOperatorName ?? undefined,
  });

  if (!ir.rawText || ir.rawText.length < 10) {
    return {
      intakeId: null,
      warnings: [...warnings, 'raw_text 부족 — IR 스냅샷 스킵'],
      created: false,
    };
  }

  const payload = {
    raw_text: ir.rawText,
    raw_text_hash: ir.rawTextHash,
    ir,
    package_id: input.packageId,
    land_operator: input.landOperatorName ?? ir.meta.landOperator,
    region: ir.meta.region,
    normalizer_version: ir.normalizerVersion,
    status: 'converted' as const,
    canary_mode: input.source === 'ir-register',
  };

  const { data: existing } = await sb
    .from('normalized_intakes')
    .select('id')
    .eq('package_id', input.packageId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await sb.from('normalized_intakes').update(payload).eq('id', existing.id);
    if (error) {
      return { intakeId: null, warnings: [...warnings, error.message], created: false };
    }
    return { intakeId: existing.id, warnings, created: false };
  }

  const { data, error } = await sb
    .from('normalized_intakes')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data?.id) {
    return {
      intakeId: null,
      warnings: [...warnings, error?.message ?? 'insert failed'],
      created: false,
    };
  }

  return { intakeId: data.id as string, warnings, created: true };
}
