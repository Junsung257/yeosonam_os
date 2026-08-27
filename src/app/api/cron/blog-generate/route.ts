import { NextRequest } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { isBlogGenerationWindowKstV4 } from '@/lib/blog-deepseek-orchestrator-v4';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { materializeBlogContentOperationsV4 } from '@/lib/blog-content-factory/materializer';
import { startBlogContentOperationWorkflowV4 } from '@/lib/blog-content-factory/start-workflow';
import { recoverExpiredBlogContentOperationsV4 } from '@/lib/blog-content-factory/watchdog';
import { resolveEffectiveBlogPublicationRollout } from '@/lib/blog-publication-rollout';
import { loadBlogPublicationRolloutState } from '@/lib/blog-publication-rollout-repository';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function runBlogGenerate(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const url = new URL(request.url);
  const forceValue = url.searchParams.get('force');
  const forcedManualRun = forceValue === '1' || forceValue === 'true';
  const scheduledGenerationEnabled = ['1', 'true'].includes(
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
  const factoryEnabled = ['1', 'true'].includes(
    String(process.env.BLOG_CONTENT_FACTORY_ENABLED || '').trim().toLowerCase(),
  );
  if (process.env.VERCEL_ENV === 'production' && !factoryEnabled) {
    return {
      skipped: true,
      reason: 'content_factory_required_in_production',
      generationCronEnabled: scheduledGenerationEnabled,
      modelCallsInCronRequest: 0,
    };
  }
  if (factoryEnabled) {
    if (!isSupabaseConfigured) return { skipped: true, reason: 'supabase_not_configured' };
    const watchdog = await recoverExpiredBlogContentOperationsV4({
      supabase: supabaseAdmin,
      limit: 20,
    });
    const policy = readBlogAutopublishPolicyV3();
    const targetQueueId = url.searchParams.get('targetQueueId')?.trim() || null;
    if (targetQueueId && !/^[0-9a-f-]{36}$/i.test(targetQueueId)) {
      return { ok: false, reason: 'content_factory_target_queue_id_invalid', factoryEnabled: true };
    }
    const stagingCanary = url.searchParams.get('stagingCanary') === '1'
      && process.env.BLOG_V4_ENVIRONMENT?.trim().toLowerCase() === 'staging'
      && policy.mode === 'draft_only';
    const rolloutStateResult = await loadBlogPublicationRolloutState(supabaseAdmin);
    if (!rolloutStateResult.state) {
      return {
        skipped: true,
        reason: `publication_rollout_state_unavailable:${rolloutStateResult.error}`,
        factoryEnabled: true,
      };
    }
    const rollout = resolveEffectiveBlogPublicationRollout({
      state: rolloutStateResult.state,
      environmentStageCeiling: policy.publicationRampStage,
      environmentDailyCap: policy.requestedDailyPublishCap,
    });
    if (rollout.frozen || rollout.dailyCap <= 0) {
      return { skipped: true, reason: 'content_factory_rollout_frozen', factoryEnabled: true, rollout };
    }
    const materialization = await materializeBlogContentOperationsV4({
      supabase: supabaseAdmin,
      stage: rollout.stage,
      environmentDailyCap: rollout.dailyCap,
      candidateLimit: 90,
      targetQueueId,
      allowQuotaBypassForTarget: stagingCanary,
    });
    const workflowStartLimit = Math.max(1, Math.min(12, Math.trunc(Number(
      process.env.BLOG_CONTENT_FACTORY_WORKFLOW_START_LIMIT || 6,
    )) || 6));
    const materializedOperationIds = [...new Set(materialization.operationIds)];
    let queuedOperationsQuery = supabaseAdmin
      .from('blog_content_operations')
      .select('id,status,lease_expires_at,queue_id')
      .in('status', ['queued', 'running'])
      .or(`status.eq.queued,lease_expires_at.is.null,lease_expires_at.lt.${new Date().toISOString()}`);
    if (materializedOperationIds.length > 0) {
      queuedOperationsQuery = queuedOperationsQuery.in('id', materializedOperationIds);
    } else if (targetQueueId) {
      queuedOperationsQuery = queuedOperationsQuery.eq('queue_id', targetQueueId);
    }
    const { data: queuedOperations, error: queuedError } = await queuedOperationsQuery
      .order('created_at', { ascending: true })
      .limit(Math.max(workflowStartLimit, materializedOperationIds.length));
    if (queuedError) {
      return {
        ok: false,
        reason: `content_factory_inventory_load_failed:${queuedError.message}`,
        factoryEnabled: true,
        materialization,
        rollout,
      };
    }
    const operationOrder = new Map(materializedOperationIds.map((id, index) => [id, index]));
    const operationsToStart = [...(queuedOperations ?? [])]
      .sort((left, right) => (operationOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (operationOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER))
      .slice(0, workflowStartLimit);
    const started = await Promise.all(operationsToStart.map(async (operation) => {
      try {
        return await startBlogContentOperationWorkflowV4({
          supabase: supabaseAdmin,
          operationId: operation.id,
          requestBaseUrl: request.nextUrl.origin,
        });
      } catch (error) {
        return {
          operationId: operation.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    return {
      ok: started.every((result) => !('error' in result)),
      factoryEnabled: true,
      generationCronEnabled: scheduledGenerationEnabled,
      autopublishMode: policy.mode,
      requestedAutopublishMode: policy.requestedMode,
      rollout,
      materialization,
      watchdog,
      workflowStartLimit,
      workflows: started,
      modelCallsInCronRequest: 0,
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
