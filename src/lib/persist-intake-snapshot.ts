/**
 * upload / backfill → normalized_intakes 역변환 스냅샷 (P1 SSOT 브릿지)
 *
 * parseDocument 경로로 저장된 pkg 를 pkgToIntake 로 IR 에 적재해
 * register-via-ir 와 동일 테이블로 수렴한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { pkgToIntake } from './pkg-to-ir';
import {
  evidenceCoverage,
  MIN_PACKAGE_EVIDENCE_COVERAGE,
  REQUIRED_PACKAGE_EVIDENCE_FIELDS,
} from './source-evidence';
import { evaluateRenderClaimCoverage } from './render-claim-coverage';

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
  evidenceCoverage?: ReturnType<typeof evidenceCoverage>;
}

async function appendEvidenceCoverageQualityCheck(
  sb: SupabaseClient,
  packageId: string,
  coverage: ReturnType<typeof evidenceCoverage>,
  renderCoverage?: ReturnType<typeof evaluateRenderClaimCoverage>,
): Promise<void> {
  const checks: Array<{ id: string; severity: 'critical' | 'high'; passed: false; message: string }> = [];
  if (coverage.ratio < MIN_PACKAGE_EVIDENCE_COVERAGE) {
    checks.push({
      id: 'source_evidence_coverage_low',
      severity: 'critical',
      passed: false,
      message: `원문 근거 coverage ${(coverage.ratio * 100).toFixed(0)}% (${coverage.covered}/${coverage.total}) — 누락: ${coverage.missing.slice(0, 8).join(', ')}`,
    });
  }
  const unsupportedCritical = renderCoverage?.unsupported.filter(c => c.severity === 'critical') ?? [];
  if (unsupportedCritical.length > 0) {
    checks.push({
      id: 'render_claim_unsupported',
      severity: 'critical',
      passed: false,
      message: `렌더 claim 원문 근거 없음 ${unsupportedCritical.length}건: ${unsupportedCritical.slice(0, 8).map(c => `${c.id}=${c.value}`).join(' / ')}`,
    });
  }
  if (checks.length === 0) return;

  const { data: latestLog } = await sb
    .from('ai_quality_log')
    .select('id, failed_checks')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestLog?.id) return;
  const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
    ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
    : [];
  const withoutDuplicate = existing.filter(c => {
    if (!c || typeof c !== 'object') return true;
    return !checks.some(next => (c as { id?: string }).id === next.id);
  });
  await sb
    .from('ai_quality_log')
    .update({ failed_checks: [...withoutDuplicate, ...checks] })
    .eq('id', latestLog.id);
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
  const coverage = evidenceCoverage(ir.sourceEvidence, [...REQUIRED_PACKAGE_EVIDENCE_FIELDS]);
  const renderCoverage = evaluateRenderClaimCoverage(input.pkg as Parameters<typeof evaluateRenderClaimCoverage>[0], ir.sourceEvidence);
  const evidenceWarnings = coverage.ratio >= MIN_PACKAGE_EVIDENCE_COVERAGE
    ? []
    : [`sourceEvidence coverage ${(coverage.ratio * 100).toFixed(0)}% (${coverage.covered}/${coverage.total}) — ${coverage.missing.join(', ')}`];
  const unsupportedCritical = renderCoverage.unsupported.filter(c => c.severity === 'critical');
  const renderWarnings = unsupportedCritical.length === 0
    ? []
    : [`render claim unsupported ${unsupportedCritical.length}건 — ${unsupportedCritical.slice(0, 8).map(c => `${c.id}=${c.value}`).join(' / ')}`];

  const { data: existing } = await sb
    .from('normalized_intakes')
    .select('id')
    .eq('package_id', input.packageId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await sb.from('normalized_intakes').update(payload).eq('id', existing.id);
    if (error) {
      return { intakeId: null, warnings: [...warnings, ...evidenceWarnings, ...renderWarnings, error.message], created: false, evidenceCoverage: coverage };
    }
    await appendEvidenceCoverageQualityCheck(sb, input.packageId, coverage, renderCoverage);
    return { intakeId: existing.id, warnings: [...warnings, ...evidenceWarnings, ...renderWarnings], created: false, evidenceCoverage: coverage };
  }

  const { data, error } = await sb
    .from('normalized_intakes')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data?.id) {
    return {
      intakeId: null,
      warnings: [...warnings, ...evidenceWarnings, ...renderWarnings, error?.message ?? 'insert failed'],
      created: false,
      evidenceCoverage: coverage,
    };
  }

  await appendEvidenceCoverageQualityCheck(sb, input.packageId, coverage, renderCoverage);
  return { intakeId: data.id as string, warnings: [...warnings, ...evidenceWarnings, ...renderWarnings], created: true, evidenceCoverage: coverage };
}
