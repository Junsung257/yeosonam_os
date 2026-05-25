import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { withCronGuard } from '@/lib/cron-auth';
import { logError, logWarning } from '@/lib/sentry-logger';
import { collectWeeklyMetrics } from '@/lib/blog-metrics-store';
import { computeAdaptiveThresholds, persistAdaptiveThresholds } from '@/lib/blog-bayesian-optimizer';
import { collectSystemHealth } from '@/lib/blog-content-orchestrator';
import { autoFinalizeExperiments } from '@/lib/ab-test-engine';

// 빌드 시 정적 분석 회피 (내부 self-fetch 가 빌드타임에 실패).
export const dynamic = 'force-dynamic';

/**
 * 블로그 자기학습 크론 — 매주 일요일 23시 실행 (KST 월요일 스케줄러 직전)
 *
 * 6가지 작업:
 *   A) Featured 자동 재선정 — 30일 내 조회수 상위 Top 3
 *   B) Prompt optimizer 호출 — 성과 분석 → agent_actions 제안 등록
 *   C) (옵션) AUTO_APPROVE_LEARNING → prompt_versions 자동 활성화
 *   D) 주간 메트릭 수집 — GSC 데이터 기반 성과 스냅샷
 *   E) 베이지안 임계값 최적화 (월 1일만) — 품질 게이트 자동 조정
 *   F) 시스템 건강 보고서 — 크론 상태 모니터링
 */
const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const result: Record<string, unknown> = { ranAt: new Date().toISOString() };

  // ── A) Featured 자동 재선정 ────────────────────────────────
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data: topPosts } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, view_count, seo_title, content_type')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .neq('content_type', 'pillar')
      .gte('published_at', since.toISOString())
      .order('view_count', { ascending: false })
      .limit(3);

    const topIds = ((topPosts as Array<{ id: string }> | null) || []).map(p => p.id);

    if (topIds.length > 0) {
      await supabaseAdmin
        .from('content_creatives')
        .update({ featured: false, featured_order: null })
        .eq('channel', 'naver_blog')
        .eq('featured', true)
        .neq('content_type', 'pillar');

      for (let i = 0; i < topIds.length; i++) {
        await supabaseAdmin
          .from('content_creatives')
          .update({ featured: true, featured_order: i + 1 })
          .eq('id', topIds[i]);
      }

      try { revalidatePath('/blog'); } catch { /* noop */ }

      result.featured_rotated = {
        count: topIds.length,
        ids: topIds,
        titles: ((topPosts as Array<{ seo_title: string | null }>) || []).map(p => p.seo_title || '(제목없음)'),
      };
    } else {
      result.featured_rotated = { count: 0, reason: '30일 내 발행글 없음' };
    }
  } catch (err) {
    logWarning('[cron/blog-learn] featured reselection failed', err);
    result.featured_error = err instanceof Error ? err.message : 'unknown';
  }

  // ── A') A/B 테스트 자동 종료 ──────────────────────────────
  try {
    const abResult = await autoFinalizeExperiments();
    result.ab_experiments_finalized = abResult;
  } catch (abErr) {
    logWarning('[cron/blog-learn] A/B autoFinalize 실패', abErr);
    result.ab_experiments_error = abErr instanceof Error ? abErr.message : 'unknown';
  }

  // ── B) Prompt optimizer (조기 종료 없이 result만 채움) ─────
  try {
    const optRes = await fetch(`${baseUrl}/api/agent/prompt-optimizer`, { method: 'POST' });
    const ct = optRes.headers.get('content-type') || '';
    if (!optRes.ok || !ct.includes('application/json')) {
      const body = await optRes.text();
      result.prompt_learning = { step: 'analysis', status: 'unreachable', http_status: optRes.status, body: body.slice(0, 200) };
    } else {
      const optData = await optRes.json();
      if (optData.status !== 'suggestion_created') {
        result.prompt_learning = { step: 'analysis', status: optData.status, message: optData.message };
      } else {
        const actionId = optData.action_id;
        const autoApprove = process.env.AUTO_APPROVE_LEARNING === 'true';

        if (!autoApprove) {
          result.prompt_learning = {
            step: 'waiting_approval',
            action_id: actionId,
            summary: optData.analysis?.summary,
            note: '사장님 승인 대기. AUTO_APPROVE_LEARNING=true 설정 시 자동 적용.',
          };
        } else {
          const { data: action } = await supabaseAdmin
            .from('agent_actions')
            .select('payload, id')
            .eq('id', actionId)
            .limit(1);

          const args = action?.[0]?.payload || {};
          args.action_id = actionId;

          const { executeAction } = await import('@/lib/agent-action-executor');
          const execResult = await executeAction('prompt_improvement_suggestion', args);
          if (!execResult.success) throw new Error(execResult.error);

          await supabaseAdmin
            .from('agent_actions')
            .update({ status: 'executed', executed_at: new Date().toISOString(), execution_result: execResult })
            .eq('id', actionId);

          result.prompt_learning = {
            step: 'auto_applied',
            action_id: actionId,
            new_version: (execResult.data as any)?.new_version,
            from_version: (execResult.data as any)?.from_version,
          };
        }
      }
    }
  } catch (err) {
    logError('[cron/blog-learn] learning failed', err);
    result.prompt_learning = { error: err instanceof Error ? err.message : '학습 실패' };
  }

  // ── D) 주간 메트릭 수집 ──────────────────────────────────
  try {
    const metricsResult = await collectWeeklyMetrics();
    result.metrics_collected = {
      total: metricsResult.total,
      updated: metricsResult.updated,
      errors: metricsResult.errors.length > 0 ? metricsResult.errors.slice(0, 3) : [],
    };
  } catch (err) {
    logWarning('[cron/blog-learn] metrics collection failed', err);
    result.metrics_collected = { error: err instanceof Error ? err.message : 'unknown' };
  }

  // ── E) 베이지안 임계값 최적화 (월 1회 — 1일이면 실행) ────
  const today = new Date().getDate();
  if (today <= 2) {
    try {
      const newThresholds = await computeAdaptiveThresholds();
      await persistAdaptiveThresholds(newThresholds);
      result.adaptive_thresholds = {
        applied: true,
        infoMinLen: newThresholds.infoMinLen,
        productMinLen: newThresholds.productMinLen,
        infoMinReadability: newThresholds.infoMinReadability,
        rationale: newThresholds.rationale,
      };
    } catch (err) {
      logWarning('[cron/blog-learn] bayesian optimizer failed', err);
      result.adaptive_thresholds = { applied: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  } else {
    result.adaptive_thresholds = { applied: false, reason: `월 1일만 실행 (오늘=${today}일)` };
  }

  // ── F) 시스템 건강 보고서 ─────────────────────────────────
  try {
    const health = await collectSystemHealth();
    result.system_health = {
      healthy: health.healthy,
      cronStatuses: health.cronStatuses.map(cs => ({
        name: cs.name,
        status: cs.status,
        consecutiveFailures: cs.consecutiveFailures,
      })),
      queueFailed: health.queueHealth.failed,
      advice: health.strategicAdvice.slice(0, 3),
    };
  } catch (err) {
    logWarning('[cron/blog-learn] health check failed', err);
    result.system_health = { error: err instanceof Error ? err.message : 'unknown' };
  }

  return NextResponse.json(result);
};

export const GET = withCronGuard(getHandler);
