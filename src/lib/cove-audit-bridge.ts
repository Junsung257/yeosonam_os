/**
 * @file cove-audit-bridge.ts
 * @description db/cove_audit.js (CommonJS) 를 TypeScript 에서 호출하는 bridge.
 *              INSERT 직후 fire-and-forget 으로 호출되어 ai_quality_log 에 결과 적재.
 *
 * 박제 사유 (2026-05-13): 신뢰도 V2 의 cross-validation 룰 set은 결정적 룰 10개만.
 * CoVe는 LLM 기반 claim-by-claim 환각 감지 — 룰로 못 잡는 미묘한 사실 누락/왜곡 발견.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

interface CoVeResult {
  warnings?: Array<{
    claim_id: string;
    claim_text: string;
    verdict: string;       // 'verified' | 'unverified' | 'contradicted'
    evidence?: string | null;
    severity?: string;
  }>;
  meta?: { claims_checked: number; cost_estimate?: number };
}

/** 비동기 백그라운드 CoVe 감사 실행 + 결과 적재. 호출자는 await 불필요. */
export async function runCoVeInBackground(packageId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    // 1) pkg 다시 로드
    const { data: pkg, error: loadErr } = await supabaseAdmin
      .from('travel_packages')
      .select('*')
      .eq('id', packageId)
      .maybeSingle();
    if (loadErr || !pkg) {
      console.warn('[CoVe-bridge] pkg load 실패(무시):', loadErr?.message ?? 'no row');
      return;
    }

    // 2) CoVe CommonJS 모듈 dynamic load
    const mod = await import('../../db/cove_audit.js') as unknown as {
      runCoVeAudit?: (p: unknown) => Promise<CoVeResult> | CoVeResult;
      default?: { runCoVeAudit?: (p: unknown) => Promise<CoVeResult> | CoVeResult };
    };
    const runCoVeAudit = mod.runCoVeAudit ?? mod.default?.runCoVeAudit;
    if (typeof runCoVeAudit !== 'function') {
      console.warn('[CoVe-bridge] runCoVeAudit 함수 export 누락');
      return;
    }

    const result = await runCoVeAudit(pkg);

    // 3) ai_quality_log 가장 최근 행에 결과 적재 (UPDATE)
    const { data: latestLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('id')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLog?.id) {
      // CoVe warnings 를 failed_checks 에도 합쳐서 모니터링 한 화면에 표시 (Phase 5-5 박제)
      const warnings = result.warnings ?? [];
      const { data: existing } = await supabaseAdmin
        .from('ai_quality_log')
        .select('failed_checks')
        .eq('id', latestLog.id)
        .maybeSingle();

      const existingChecks = Array.isArray((existing as { failed_checks?: unknown[] } | null)?.failed_checks)
        ? ((existing as { failed_checks: unknown[] }).failed_checks)
        : [];
      const coveAsChecks = warnings
        .filter(w => w.verdict !== 'verified')
        .map(w => ({
          id: `cove_${w.claim_id ?? 'unknown'}`,
          severity: (w.severity === 'critical' ? 'critical' : w.severity === 'medium' ? 'medium' : 'high') as 'critical' | 'high' | 'medium',
          passed: false,
          // claim_text 가 undefined 인 cove_audit.js 응답에서 전체 감사가 throw 되던 회귀 가드 (2026-05-14)
          message: `CoVe ${w.verdict ?? 'unknown'}: ${(w.claim_text ?? '').slice(0,80)}`,
        }));

      await supabaseAdmin
        .from('ai_quality_log')
        .update({
          cove_warnings:     warnings,
          cove_completed_at: new Date().toISOString(),
          failed_checks:     [...existingChecks, ...coveAsChecks],
        })
        .eq('id', latestLog.id);
    }

    if ((result.warnings?.length ?? 0) > 0) {
      console.log(`[CoVe-bridge] ${packageId}: ${result.warnings?.length} warnings → failed_checks 병합`);
    }
  } catch (e) {
    console.warn('[CoVe-bridge] 감사 실패(무시):', (e as Error).message);
  }
}
