/**
 * @file /api/admin/registration-monitor/route.ts
 * @description 등록 정확도 모니터링 대시보드 데이터 API.
 *
 * 박제 사유 (2026-05-13): registration_auto_policy 의 풀자동 전환 트리거 4 조건을
 * 사장님이 한 화면에서 평가할 수 있도록 자동 계산.
 *
 * 응답:
 *   - last30dStats: 30일 거절률, leak 건수, CoVe 통과율, Reflexion 누적
 *   - triggerEval: 4 조건 충족 여부 + 풀자동 전환 추천
 *   - recentLog: 최근 등록 20건 (V2 breakdown + leak + cove)
 *   - dailyTrend: 30일 일별 confidence 평균 + 등록 건수
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getRegistrationPolicy, invalidateRegistrationPolicyCache, type RegistrationPolicy } from '@/lib/registration-policy';
import { refreshConformalPolicy } from '@/lib/conformal-calibration';
import { evaluateSectionCacheCanary, type SectionCacheCanaryResult } from '@/lib/section-cache-canary';
import {
  evaluateProductRegistrationCorpus,
  type ProductRegistrationCorpusEval,
} from '@/lib/product-registration-evaluator';

interface TriggerCondition {
  id: 'reject_rate' | 'weekly_leak' | 'cove_pass_rate' | 'reflexion_count';
  label: string;
  actual: number | string;
  threshold: number;
  passed: boolean;
  description: string;
}

interface MonitorResponse {
  policy: RegistrationPolicy;
  last30dStats: {
    total_registrations: number;
    rejected_count: number;
    reject_rate: number;
    confirm_queue_count: number;
    auto_publish_count: number;
    avg_confidence: number;
    weekly_leak_count: number;
    cove_pass_rate: number;
    reflexion_count: number;
    mobile_qa_incidents: number;
    verify_deterministic_incidents: number;
    cove_incidents: number;
    confidence_mismatch_incidents: number;
    section_cache_hit_count: number;
    section_cache_reduce_ready_count: number;
    section_cache_reduced_chars: number;
    section_cache_hit_rate: number;
  };
  triggerEval: {
    conditions: TriggerCondition[];
    all_passed: boolean;
    recommendation: 'enable_full_auto' | 'continue_confirm_queue' | 'investigate';
    summary: string;
  };
  recentLog: Array<{
    id: number;
    package_id: string | null;
    internal_code: string | null;
    confidence: number;
    fill_score: number;
    xvalid_score: number;
    leak_score: number;
    auto_gate: string;
    failed_checks_count: number;
    leak_incidents_count: number;
    section_cache_hit_count: number;
    section_cache_reduced_chars: number;
    section_cache_reduce_ready: boolean;
    section_cache_replaced_labels: string[];
    created_at: string;
  }>;
  dailyTrend: Array<{
    date: string;
    count: number;
    avg_confidence: number;
    rejected: number;
  }>;
  sectionCacheCanary: SectionCacheCanaryResult;
  productRegistrationCorpus: ProductRegistrationCorpusEval;
}

const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const policy = await getRegistrationPolicy();

    // 30일 윈도우
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();

    // 1) ai_quality_log 30일 통계
    const { data: logs } = await supabaseAdmin
      .from('ai_quality_log')
      .select('confidence, auto_gate, leak_score, cove_warnings, created_at, failed_checks, leak_incidents, section_cache_hit_count, section_cache_reduced_chars, section_cache_reduce_ready, section_cache_replaced_labels')
      .gte('created_at', since30d)
      .order('created_at', { ascending: false });

    const rows = (logs ?? []) as Array<{
      confidence: number; auto_gate: string; leak_score: number; cove_warnings?: unknown[];
      created_at: string;
      failed_checks?: unknown[]; leak_incidents?: unknown[];
      section_cache_hit_count?: number;
      section_cache_reduced_chars?: number;
      section_cache_reduce_ready?: boolean;
      section_cache_replaced_labels?: string[];
    }>;

    const total = rows.length;
    const rejected     = rows.filter(r => r.auto_gate === 'rejected').length;
    const confirmQ     = rows.filter(r => r.auto_gate === 'confirm_queue').length;
    const autoPub      = rows.filter(r => r.auto_gate === 'auto_publish').length;
    const avgConf      = total > 0 ? rows.reduce((s, r) => s + Number(r.confidence ?? 0), 0) / total : 0;
    const rejectRate   = total > 0 ? rejected / total : 0;
    const sectionCacheHitCount = rows.reduce((s, r) => s + Number(r.section_cache_hit_count ?? 0), 0);
    const sectionCacheReadyCount = rows.filter(r => Boolean(r.section_cache_reduce_ready)).length;
    const sectionCacheReducedChars = rows.reduce((s, r) => s + Number(r.section_cache_reduced_chars ?? 0), 0);
    const sectionCacheHitRate = total > 0 ? rows.filter(r => Number(r.section_cache_hit_count ?? 0) > 0).length / total : 0;

    // R3-C 박제 (2026-05-22) — failed_checks incident 분류 (prefix 기반)
    // mobile_*  = 자동 모바일 QA, verify_*  = 결정적 룰 (C1~C10),
    // cove_*    = CoVe critic, confidence_verify_mismatch = 거짓 신호 (R3-A)
    let mobileQaCount = 0;
    let verifyDeterministicCount = 0;
    let coveCount = 0;
    let confidenceMismatchCount = 0;
    for (const r of rows) {
      const checks = Array.isArray(r.failed_checks) ? r.failed_checks : [];
      for (const c of checks as Array<{ id?: string }>) {
        const id = c?.id ?? '';
        if (id.startsWith('mobile_'))                       mobileQaCount++;
        else if (id.startsWith('verify_'))                  verifyDeterministicCount++;
        else if (id.startsWith('cove_'))                    coveCount++;
        else if (id === 'confidence_verify_mismatch')       confidenceMismatchCount++;
      }
    }
    const weeklyLeak   = rows.filter(r =>
      r.created_at >= since7d &&
      Array.isArray(r.leak_incidents) && r.leak_incidents.length > 0
    ).length;
    const coveDone     = rows.filter(r => Array.isArray(r.cove_warnings));
    const covePassRate = coveDone.length > 0
      ? coveDone.filter(r => (r.cove_warnings?.length ?? 0) === 0).length / coveDone.length
      : 1;
    const sectionCacheCanary = evaluateSectionCacheCanary({
      totalRegistrations: total,
      reduceReadyCount: sectionCacheReadyCount,
      reducedChars: sectionCacheReducedChars,
      qualityIncidentCount: mobileQaCount + verifyDeterministicCount + coveCount + confidenceMismatchCount,
    });
    const productRegistrationCorpus = evaluateProductRegistrationCorpus();

    // 2) extractions_corrections 누적
    const { count: reflexionCount } = await supabaseAdmin
      .from('extractions_corrections')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // 3) 트리거 조건 평가
    const conditions: TriggerCondition[] = [
      {
        id: 'reject_rate',
        label: '30일 거절률',
        actual: Math.round(rejectRate * 1000) / 10 + '%',
        threshold: policy.trigger_max_reject_rate_30d * 100,
        passed: rejectRate <= policy.trigger_max_reject_rate_30d,
        description: `목표 ${(policy.trigger_max_reject_rate_30d * 100).toFixed(0)}% 이하`,
      },
      {
        id: 'weekly_leak',
        label: '주간 leak 건수',
        actual: weeklyLeak,
        threshold: policy.trigger_max_leak_per_week,
        passed: weeklyLeak <= policy.trigger_max_leak_per_week,
        description: `목표 ${policy.trigger_max_leak_per_week}건 이하`,
      },
      {
        id: 'cove_pass_rate',
        label: 'CoVe 통과율',
        actual: Math.round(covePassRate * 1000) / 10 + '%',
        threshold: policy.trigger_min_cove_pass_rate * 100,
        passed: covePassRate >= policy.trigger_min_cove_pass_rate,
        description: `목표 ${(policy.trigger_min_cove_pass_rate * 100).toFixed(0)}% 이상`,
      },
      {
        id: 'reflexion_count',
        label: 'Reflexion 누적',
        actual: reflexionCount ?? 0,
        threshold: policy.trigger_min_reflexion_count,
        passed: (reflexionCount ?? 0) >= policy.trigger_min_reflexion_count,
        description: `목표 ${policy.trigger_min_reflexion_count}건 이상`,
      },
    ];

    const allPassed = conditions.every(c => c.passed);
    const recommendation: MonitorResponse['triggerEval']['recommendation'] =
      allPassed && !policy.full_auto_enabled ? 'enable_full_auto' :
      policy.full_auto_enabled ? 'continue_confirm_queue' :  // 이미 풀자동인데 표시
      'continue_confirm_queue';
    const failedConditions = conditions.filter(c => !c.passed).length;
    const summary = allPassed
      ? policy.full_auto_enabled
        ? '✅ 풀자동 운영 중 — 4 조건 모두 충족. 안정적 운영 중입니다.'
        : '🎯 풀자동 전환 가능 — 4 조건 모두 충족. SQL 1줄로 활성화: UPDATE registration_auto_policy SET full_auto_enabled=true WHERE id=1;'
      : `⚠ ${failedConditions} 조건 미충족 — 컨펌 큐 유지 권장`;

    // Phase 9 Final — 자동화 상태 통합 (카드뉴스 + fraud + booking task)
    const { data: cardNewsGuard } = await supabaseAdmin
      .from('card_news_publish_guards')
      .select('auto_publish_enabled, auto_publish_dry_run, dry_run_activated_at, anomaly_paused_until')
      .maybeSingle();

    const { count: fraudOpen } = await supabaseAdmin
      .from('fraud_signals_log')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null);

    // P13-4 박제 (2026-05-13): fraud 정확도 + false positive rate (resolved_by + notes 분석)
    const { data: fraudResolvedRows } = await supabaseAdmin
      .from('fraud_signals_log')
      .select('severity, auto_action, resolved_at, notes')
      .not('resolved_at', 'is', null)
      .gte('detected_at', since30d);

    const fraudResolved = (fraudResolvedRows ?? []) as Array<{ severity: string; auto_action: string; notes: string | null }>;
    const fraudTotal30d = fraudResolved.length;
    // false positive 마킹: notes 에 "false positive" / "오진" / "정상" 포함
    const fraudFalsePositive = fraudResolved.filter(r =>
      r.notes && /false[\s_]?positive|오진|정상\s*예약/i.test(r.notes)
    ).length;
    const fraudBlocked = fraudResolved.filter(r => r.auto_action === 'blocked').length;
    const fraudFalsePositiveRate = fraudTotal30d > 0
      ? Math.round((fraudFalsePositive / fraudTotal30d) * 1000) / 1000
      : 0;
    const fraudPrecision = fraudTotal30d > 0
      ? Math.round(((fraudTotal30d - fraudFalsePositive) / fraudTotal30d) * 1000) / 1000
      : null;

    const { count: fraud24hAuto } = await supabaseAdmin
      .from('fraud_signals_log')
      .select('*', { count: 'exact', head: true })
      .eq('auto_action', 'memo_marked')
      .gte('detected_at', since7d);

    // 4) 최근 20건 로그
    const recent = rows.slice(0, 20).map((r, i) => {
      const full = (logs?.[i] ?? {}) as Record<string, unknown>;
      return {
        id: Number(full.id ?? 0),
        package_id: (full.package_id as string) ?? null,
        internal_code: (full.internal_code as string) ?? null,
        confidence: Number(full.confidence ?? 0),
        fill_score: Number(full.fill_score ?? 0),
        xvalid_score: Number(full.xvalid_score ?? 0),
        leak_score: Number(full.leak_score ?? 0),
        auto_gate: String(full.auto_gate ?? ''),
        failed_checks_count: Array.isArray(r.failed_checks) ? r.failed_checks.length : 0,
        leak_incidents_count: Array.isArray(r.leak_incidents) ? r.leak_incidents.length : 0,
        section_cache_hit_count: Number(full.section_cache_hit_count ?? 0),
        section_cache_reduced_chars: Number(full.section_cache_reduced_chars ?? 0),
        section_cache_reduce_ready: Boolean(full.section_cache_reduce_ready),
        section_cache_replaced_labels: Array.isArray(full.section_cache_replaced_labels)
          ? full.section_cache_replaced_labels.map(String)
          : [],
        created_at: r.created_at,
      };
    });

    // 5) 일별 추세 (30일)
    const daily = new Map<string, { count: number; sumConf: number; rejected: number }>();
    for (const r of rows) {
      const d = r.created_at.slice(0, 10);
      const e = daily.get(d) ?? { count: 0, sumConf: 0, rejected: 0 };
      e.count++;
      e.sumConf += Number(r.confidence ?? 0);
      if (r.auto_gate === 'rejected') e.rejected++;
      daily.set(d, e);
    }
    const dailyTrend = Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        count: v.count,
        avg_confidence: v.count > 0 ? Math.round((v.sumConf / v.count) * 1000) / 1000 : 0,
        rejected: v.rejected,
      }));

    const response: MonitorResponse & {
      cardNewsAutomation?: unknown;
      fraudStats?: unknown;
    } = {
      policy,
      cardNewsAutomation: cardNewsGuard ?? null,
      fraudStats: {
        unresolved: fraudOpen ?? 0,
        auto_quarantined_7d: fraud24hAuto ?? 0,
        // P13-4 박제: 정확도 메트릭 (30일 윈도우)
        total_30d:               fraudTotal30d,
        blocked_30d:             fraudBlocked,
        false_positive_30d:      fraudFalsePositive,
        false_positive_rate:     fraudFalsePositiveRate,
        precision:               fraudPrecision,  // null 이면 데이터 부족
      },
      last30dStats: {
        total_registrations: total,
        rejected_count: rejected,
        reject_rate: Math.round(rejectRate * 1000) / 1000,
        confirm_queue_count: confirmQ,
        auto_publish_count: autoPub,
        avg_confidence: Math.round(avgConf * 1000) / 1000,
        weekly_leak_count: weeklyLeak,
        cove_pass_rate: Math.round(covePassRate * 1000) / 1000,
        reflexion_count: reflexionCount ?? 0,
        // R3-C — incident 분류 카운트 (30일)
        mobile_qa_incidents: mobileQaCount,
        verify_deterministic_incidents: verifyDeterministicCount,
        cove_incidents: coveCount,
        confidence_mismatch_incidents: confidenceMismatchCount,
        section_cache_hit_count: sectionCacheHitCount,
        section_cache_reduce_ready_count: sectionCacheReadyCount,
        section_cache_reduced_chars: sectionCacheReducedChars,
        section_cache_hit_rate: Math.round(sectionCacheHitRate * 1000) / 1000,
      },
      triggerEval: { conditions, all_passed: allPassed, recommendation, summary },
      recentLog: recent,
      dailyTrend,
      sectionCacheCanary,
      productRegistrationCorpus,
    };

    return apiResponse(response);
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

/** POST: 정책 임계치 업데이트 또는 액션 트리거.
 *   body.action === 'recalibrate_conformal' → 강제 재보정 실행
 *   body.action === undefined / 정책 patch → 임계치 업데이트
 */
const postHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }
  try {
    let body: Partial<RegistrationPolicy> & { notes?: string; action?: string };
    try {
      body = await req.json() as Partial<RegistrationPolicy> & { notes?: string; action?: string };
    } catch {
      return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
    }

    // 액션 분기 — 강제 Conformal 재보정 (사장님 1-click)
    if (body.action === 'recalibrate_conformal') {
      const result = await refreshConformalPolicy();
      invalidateRegistrationPolicyCache();
      return apiResponse({
        ok: true,
        action: 'recalibrate_conformal',
        threshold: result.threshold,
        sampleSize: result.sampleSize,
        alpha: result.alpha,
        reason: result.reason,
      });
    }

    const allowed: Array<keyof RegistrationPolicy> = [
      'auto_publish_above', 'confirm_queue_above', 'pending_review_above',
      'reject_leak_score_above', 'full_auto_enabled',
      'trigger_max_reject_rate_30d', 'trigger_max_leak_per_week',
      'trigger_min_cove_pass_rate', 'trigger_min_reflexion_count',
      'conformal_target_alpha', 'conformal_min_sample', 'conformal_enabled',
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }
    if (body.notes) patch.notes = body.notes;

    const { error } = await supabaseAdmin
      .from('registration_auto_policy')
      .update(patch)
      .eq('id', 1);
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

    invalidateRegistrationPolicyCache();
    return apiResponse({ ok: true, patched: patch });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
