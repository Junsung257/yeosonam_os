import { NextRequest } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { isBlogGenerationWindowKstV4 } from '@/lib/blog-deepseek-orchestrator-v4';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { blogPipelineRequestedEvent, inngest } from '@/inngest/client';
import {
  isInngestBlogAutopilotConfigured,
  isInngestBlogAutopilotEnabled,
} from '@/inngest/runtime-policy';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { createBlogPipelineEventId } from '@/lib/blog-autopilot-v4-contract';
import {
  getBlogPublishingPolicy,
  loadQueueDemandSignalMapV3,
  selectPublishableQueueCandidates,
} from '@/lib/blog-scheduler';
import { getKstDayRange } from '@/lib/blog-daily-summary-window';
import {
  quarantineNonRetryableBlogQueueItems,
  shouldQuarantineQueuedBlogItem,
} from '@/lib/blog-queue-lifecycle';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runBlogGenerate(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const url = new URL(request.url);
  const forceValue = url.searchParams.get('force');
  const forcedManualRun = forceValue === '1' || forceValue === 'true';
  const targetQueueId = url.searchParams.get('targetQueueId')?.trim() || null;
  if (targetQueueId && !forcedManualRun) {
    return { skipped: true, reason: 'target_queue_id_requires_forced_manual_run' };
  }
  if (targetQueueId && !UUID_PATTERN.test(targetQueueId)) {
    return { skipped: true, reason: 'target_queue_id_invalid' };
  }
  const requestedManualLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const perRunLimit = forcedManualRun
    && Number.isSafeInteger(requestedManualLimit)
    && requestedManualLimit >= 1
    && requestedManualLimit <= 2
    ? requestedManualLimit
    : 2;
  const durableWorkflowRequested = isInngestBlogAutopilotEnabled();
  const durableWorkflowConfigured = isInngestBlogAutopilotConfigured();
  if (durableWorkflowRequested && !durableWorkflowConfigured) {
    const policy = readBlogAutopublishPolicyV3();
    return {
      skipped: true,
      reason: 'inngest_blog_autopilot_credentials_missing',
      generationCronEnabled: false,
      autopublishMode: policy.mode,
      requestedAutopublishMode: policy.requestedMode,
      requiredSecrets: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'],
    };
  }
  const scheduledGenerationEnabled = durableWorkflowConfigured || ['1', 'true'].includes(
    String(process.env.BLOG_GENERATION_CRON_ENABLED || '').trim().toLowerCase(),
  );
  if (!forcedManualRun && !scheduledGenerationEnabled) {
    const policy = readBlogAutopublishPolicyV3();
    return {
      skipped: true,
      reason: 'blog_generation_cron_paused',
      generationCronEnabled: false,
      autopublishMode: policy.mode,
      requestedAutopublishMode: policy.requestedMode,
      nextAction: 'set BLOG_GENERATION_CRON_ENABLED=1 for scheduled DeepSeek generation; publishing still requires BLOG_AUTOPUBLISH_MODE=live',
    };
  }
  if (!forcedManualRun && !isBlogGenerationWindowKstV4(new Date())) {
    return { skipped: true, reason: 'outside_kst_offpeak_generation_window' };
  }
  if (durableWorkflowConfigured) {
    if (!isSupabaseAdminConfigured) {
      return { skipped: true, reason: 'supabase_admin_not_configured' };
    }
    const policy = await getBlogPublishingPolicy('global');
    const dailyTarget = policy.posts_per_day;
    if (dailyTarget <= 0) {
      return { skipped: true, reason: 'blog_publishing_policy_paused', dailyTarget };
    }
    const range = getKstDayRange(0, new Date());
    const { count: generatedToday, error: generationCountError } = await supabaseAdmin
      .from('blog_generation_runs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', range.start.toISOString())
      .lt('created_at', range.end.toISOString());
    if (generationCountError) {
      return {
        skipped: true,
        reason: 'blog_generation_daily_quota_unavailable',
        error: generationCountError.message,
      };
    }
    const remainingToday = Math.max(0, dailyTarget - Number(generatedToday ?? 0));
    if (remainingToday <= 0) {
      return {
        skipped: true,
        reason: 'blog_generation_daily_quota_reached',
        dailyTarget,
        generatedToday: Number(generatedToday ?? 0),
        dayKey: range.dayKey,
      };
    }
    const dispatchLimit = Math.min(perRunLimit, remainingToday);
    const preflightSettlement = await quarantineNonRetryableBlogQueueItems({
      limit: Math.max(dispatchLimit * 10, 20),
      maxAttempts: 3,
    });
    let candidateQuery = supabaseAdmin
      .from('blog_topic_queue')
      .select('id,updated_at,target_publish_at,attempts,last_error,meta,source,product_id,content_creative_id,topic,destination,primary_keyword,category,angle_type,priority,created_at,monthly_search_volume,trend_score')
      .eq('status', 'queued')
      .or('attempts.is.null,attempts.lt.3');
    if (targetQueueId) {
      candidateQuery = candidateQuery.eq('id', targetQueueId);
    } else {
      candidateQuery = candidateQuery
        .order('priority', { ascending: false })
        .order('target_publish_at', { ascending: true, nullsFirst: false });
    }
    const candidatePoolLimit = targetQueueId ? 1 : Math.max(dispatchLimit * 100, 200);
    const { data: candidatePool, error } = await candidateQuery.limit(candidatePoolLimit);
    if (error) throw new Error(`blog_pipeline_dispatch_query_failed:${error.message}`);

    const lifecycleCandidates = (candidatePool ?? [])
      .filter((candidate) => !shouldQuarantineQueuedBlogItem({
        attempts: candidate.attempts,
        lastError: candidate.last_error,
        meta: candidate.meta,
        maxAttempts: 3,
      }).quarantine);
    const since = new Date();
    since.setDate(since.getDate() - Math.max(14, policy.multi_angle_gap_days ?? 14));
    const [recentPublishedResult, activeRepresentativesResult] = await Promise.all([
      supabaseAdmin
        .from(PUBLIC_BLOG_READ_SOURCE)
        .select('destination,angle_type,slug,product_id,generation_meta')
        .gte('published_at', since.toISOString())
        .limit(500),
      supabaseAdmin
        .from('blog_information_representatives')
        .select('representative_key')
        .eq('status', 'active')
        .limit(2000),
    ]);
    if (recentPublishedResult.error || activeRepresentativesResult.error) {
      return {
        skipped: true,
        reason: 'blog_pipeline_dispatch_readiness_unavailable',
        targetQueueId,
        errors: [
          recentPublishedResult.error?.message,
          activeRepresentativesResult.error?.message,
        ].filter(Boolean),
        preflightSettlement,
      };
    }
    const activeRepresentativeKeys = new Set(
      (activeRepresentativesResult.data ?? [])
        .map((row) => row.representative_key)
        .filter((key): key is string => typeof key === 'string' && key.length > 0),
    );
    const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(lifecycleCandidates);
    const dispatchReadiness = selectPublishableQueueCandidates({
      activeQueue: lifecycleCandidates,
      recentPublished: recentPublishedResult.data ?? [],
      activeRepresentativeKeys,
      demandSignalsByQueueId,
      limit: targetQueueId ? 1 : dispatchLimit,
    });
    const candidates = dispatchReadiness.candidates.filter(
      (candidate): candidate is typeof candidate & { id: string } => (
        typeof candidate.id === 'string' && candidate.id.length > 0
      ),
    );
    if (!candidates?.length) {
      return {
        skipped: true,
        reason: targetQueueId
          ? 'target_queue_item_not_dispatchable'
          : 'no_queued_blog_pipeline_candidate',
        targetQueueId,
        preflightSettlement,
        dispatchReadiness,
      };
    }
    const requestedAt = new Date().toISOString();
    const events = candidates.map((candidate) => {
      const contentVersion = String(candidate.updated_at || candidate.target_publish_at || requestedAt);
      return blogPipelineRequestedEvent.create({
        queueId: candidate.id,
        contentVersion,
        mode: 'generate_only',
        requestedAt,
      }, {
        id: createBlogPipelineEventId({ queueId: candidate.id, contentVersion }),
      });
    });
    await inngest.send(events);
    return {
      dispatched: events.length,
      durableWorkflow: 'blog-autopilot-v4',
      queueIds: candidates.map((candidate) => candidate.id),
      modelCalls: 0,
      forcedManualDispatch: forcedManualRun,
      targetQueueId,
      preflightSettlement,
      dispatchReadiness,
      dailyTarget,
      generatedToday: Number(generatedToday ?? 0),
      remainingToday,
      dayKey: range.dayKey,
    };
  }
  url.pathname = '/api/cron/blog-publisher';
  url.searchParams.set('phase', 'generate_only');
  const response = await fetch(url, {
    method: 'GET',
    headers: request.headers,
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return { ok: response.ok, status: response.status, body: await response.text() };
}

export const GET = withCronLogging('blog-generate', runBlogGenerate, {
  handlerTimeoutMs: 285_000,
});
