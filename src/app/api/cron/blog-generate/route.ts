import { NextRequest } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { isBlogGenerationWindowKstV4 } from '@/lib/blog-deepseek-orchestrator-v4';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { blogPipelineRequestedEvent, inngest } from '@/inngest/client';
import { isInngestBlogAutopilotEnabled } from '@/inngest/runtime-policy';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { createBlogPipelineEventId } from '@/lib/blog-autopilot-v4-contract';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function runBlogGenerate(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const url = new URL(request.url);
  const forceValue = url.searchParams.get('force');
  const forcedManualRun = forceValue === '1' || forceValue === 'true';
  const durableWorkflowEnabled = isInngestBlogAutopilotEnabled();
  const scheduledGenerationEnabled = durableWorkflowEnabled || ['1', 'true'].includes(
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
  if (durableWorkflowEnabled) {
    if (!isSupabaseAdminConfigured) {
      return { skipped: true, reason: 'supabase_admin_not_configured' };
    }
    const { data: candidates, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('id,updated_at,target_publish_at')
      .eq('status', 'queued')
      .or('attempts.is.null,attempts.lt.3')
      .order('priority', { ascending: false })
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .limit(2);
    if (error) throw new Error(`blog_pipeline_dispatch_query_failed:${error.message}`);
    if (!candidates?.length) {
      return { skipped: true, reason: 'no_queued_blog_pipeline_candidate' };
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
