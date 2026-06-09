import { NextRequest } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { logError, logWarning } from '@/lib/sentry-logger';
import { collectWeeklyMetrics } from '@/lib/blog-metrics-store';
import { computeAdaptiveThresholds, persistAdaptiveThresholds } from '@/lib/blog-bayesian-optimizer';
import { collectSystemHealth } from '@/lib/blog-content-orchestrator';
import { autoFinalizeExperiments } from '@/lib/ab-test-engine';
import { getSecret } from '@/lib/secret-registry';
import { sanitizeDbError } from '@/lib/error-sanitizer';

// 빌드 시 정적 분석 회피 (내부 self-fetch 가 빌드타임에 실패).
export const dynamic = 'force-dynamic';

/**
 * 블로그 자기학습 크론 — 매주 일요일 23시 실행 (KST 월요일 스케줄러 직전)
 *
 * 6가지 작업:
 *   A) Featured 자동 재선정
 *   B) Prompt optimizer
 *   C) (옵션) AUTO_APPROVE_LEARNING → prompt_versions 자동 활성화
 *   D) 주간 메트릭 수집
 *   E) 베이지안 임계값 최적화 (월 1일만)
 *   F) 시스템 건강 보고서
 */
const handleBlogLearn = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const baseUrl = new URL(request.url).origin;
  const result: Record<string, unknown> = { ranAt: new Date().toISOString() };
  const errors: string[] = [];

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
      .not('og_image_url', 'is', null)
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
    const msg = sanitizeDbError(err);
    result.featured_error = msg;
    errors.push(`featured: ${msg}`);
  }

  // ── A') A/B 테스트 자동 종료 ──────────────────────────────
  try {
    const abResult = await autoFinalizeExperiments();
    result.ab_experiments_finalized = abResult;
  } catch (abErr) {
    logWarning('[cron/blog-learn] A/B autoFinalize 실패', abErr);
    const msg = sanitizeDbError(abErr);
    result.ab_experiments_error = msg;
    errors.push(`ab_experiments: ${msg}`);
  }

  // ── B) Prompt optimizer ─────────────────────────────────────
  try {
    const serviceRoleKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
    const optRes = await fetch(`${baseUrl}/api/agent/prompt-optimizer`, {
      method: 'POST',
      headers: serviceRoleKey ? { Authorization: `Bearer ${serviceRoleKey}` } : undefined,
    });
    const ct = optRes.headers.get('content-type') || '';
    if (!optRes.ok || !ct.includes('application/json')) {
      const body = await optRes.text();
      result.prompt_learning = { step: 'analysis', status: 'unreachable', http_status: optRes.status, body: sanitizeDbError(body) };
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
            new_version: (execResult.data as Record<string, unknown>)?.new_version,
            from_version: (execResult.data as Record<string, unknown>)?.from_version,
          };
        }
      }
    }
  } catch (err) {
    logError('[cron/blog-learn] learning failed', err);
    const msg = sanitizeDbError(err, 'Learning failed');
    result.prompt_learning = { error: msg };
    errors.push(`prompt_learning: ${msg}`);
  }

  // ── D) 주간 메트릭 수집 ──────────────────────────────────
  try {
    const metricsResult = await collectWeeklyMetrics();
    result.metrics_collected = {
      total: metricsResult.total,
      updated: metricsResult.updated,
      errors: metricsResult.errors.length > 0 ? metricsResult.errors.slice(0, 3).map((me) => sanitizeDbError(me)) : [],
    };
    for (const me of metricsResult.errors.slice(0, 3)) errors.push(`metrics: ${sanitizeDbError(me)}`);
  } catch (err) {
    logWarning('[cron/blog-learn] metrics collection failed', err);
    const msg = sanitizeDbError(err);
    result.metrics_collected = { error: msg };
    errors.push(`metrics: ${msg}`);
  }

  // ── E) 베이지안 임계값 최적화 (월 1회) ────────────────────
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const [qualityRes, funnelRes] = await Promise.all([
      supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, quality_gate')
        .eq('channel', 'naver_blog')
        .eq('status', 'published')
        .gte('published_at', since.toISOString())
        .limit(200),
      supabaseAdmin
        .from('recommendation_outcomes')
        .select('outcome, package_id, recommended_rank, intent, notes')
        .eq('source', 'blog')
        .gte('recommended_at', since.toISOString())
        .limit(1000),
    ]);

    const intentFailures = ((qualityRes.data || []) as Array<{
      id: string;
      slug: string | null;
      seo_title: string | null;
      quality_gate: unknown;
    }>).filter((row) => {
      const gate = row.quality_gate as { details?: Array<{ gate?: string; passed?: boolean }> } | null;
      return Array.isArray(gate?.details)
        ? gate.details.some((detail) => detail.gate === 'intent_quality' && detail.passed === false)
        : false;
    });

    const funnelRows = (funnelRes.data || []) as Array<{
      outcome: string | null;
      package_id: string;
      recommended_rank: number | null;
      intent: string | null;
      notes: string | null;
    }>;
    const funnel = funnelRows.reduce((acc, row) => {
      const key = row.outcome || 'impression';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    result.editorial_funnel_learning = {
      since: since.toISOString(),
      intent_quality_failures: intentFailures.length,
      intent_failure_samples: intentFailures.slice(0, 5).map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.seo_title,
      })),
      blog_recommendation_funnel: funnel,
      blog_recommendation_events: funnelRows.length,
      note: 'Feeds next prompt/gate/scoring review with editorial quality failures and blog recommendation funnel data.',
    };
  } catch (err) {
    logWarning('[cron/blog-learn] editorial/funnel learning input failed', err);
    const msg = sanitizeDbError(err);
    result.editorial_funnel_learning = { error: msg };
    errors.push(`editorial_funnel: ${msg}`);
  }

  const today = new Date().getDate();
  if (today <= 2) {
    try {
      const newThresholds = await computeAdaptiveThresholds();
      await persistAdaptiveThresholds(newThresholds);
      result.adaptive_thresholds = { applied: true, ...newThresholds };
    } catch (err) {
      logWarning('[cron/blog-learn] bayesian optimizer failed', err);
      const msg = sanitizeDbError(err);
      result.adaptive_thresholds = { applied: false, error: msg };
      errors.push(`bayesian: ${msg}`);
    }
  } else {
    result.adaptive_thresholds = { applied: false, reason: `월 1일만 실행 (오늘=${today}일)` };
  }

  // ── F) 시스템 건강 보고서 ─────────────────────────────────
  try {
    const health = await collectSystemHealth();
    result.system_health = { healthy: health.healthy, cronStatuses: health.cronStatuses.map(cs => ({ name: cs.name, status: cs.status, consecutiveFailures: cs.consecutiveFailures })), queueFailed: health.queueHealth.failed, advice: health.strategicAdvice.slice(0, 3) };
  } catch (err) {
    logWarning('[cron/blog-learn] health check failed', err);
    const msg = sanitizeDbError(err);
    result.system_health = { error: msg };
    errors.push(`health: ${msg}`);
  }

  return { ...result, errors };
};

export const GET = withCronLogging('blog-learn', handleBlogLearn);
