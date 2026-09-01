import { blogPipelineRequestedEvent, inngest } from '../client';
import { isInngestBlogAutopilotEnabled } from '@/inngest/runtime-policy';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { readBlogBrowserPreviewEvidenceV4 } from '@/lib/blog-browser-preview-v4';
import { BLOG_AUTOPILOT_PIPELINE_VERSION } from '@/lib/blog-autopilot-v4-contract';

type CronPayload = Record<string, unknown>;

function resolveInternalAppOrigin(): string {
  const vercelUrl = String(process.env.VERCEL_URL || '').trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const configured = String(
    getSecret('BLOG_AUTOPILOT_INTERNAL_ORIGIN')
    || process.env.NEXT_PUBLIC_SITE_URL
    || '',
  ).trim().replace(/\/$/, '');
  if (/^https:\/\//i.test(configured)) return configured;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(configured)) {
    return configured;
  }
  throw new Error('blog_autopilot_internal_origin_missing');
}

async function invokeAuthorizedCron(pathname: string): Promise<CronPayload> {
  const cronSecret = getSecret('CRON_SECRET');
  if (!cronSecret) throw new Error('blog_autopilot_cron_secret_missing');
  const response = await fetch(`${resolveInternalAppOrigin()}${pathname}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(285_000),
  });
  const raw = await response.text();
  let payload: CronPayload = {};
  try {
    payload = raw ? JSON.parse(raw) as CronPayload : {};
  } catch {
    payload = { body: raw.slice(0, 1_000) };
  }
  if (!response.ok) {
    throw new Error(`blog_autopilot_cron_http_${response.status}:${JSON.stringify(payload).slice(0, 800)}`);
  }
  return payload;
}

export const blogAutopilotV4Fn = inngest.createFunction(
  {
    id: 'blog-autopilot-v4',
    name: '블로그 오토파일럿 V4',
    retries: 3,
    timeouts: { finish: '15m' },
    idempotency: 'event.id',
    concurrency: { limit: 1, key: 'event.data.queueId' },
    triggers: [blogPipelineRequestedEvent],
  },
  async ({ event, step }) => {
    if (!isInngestBlogAutopilotEnabled()) {
      return { skipped: true, reason: 'inngest_blog_autopilot_not_enabled' };
    }
    if (!isSupabaseAdminConfigured) {
      return { skipped: true, reason: 'supabase_admin_not_configured' };
    }

    const { queueId, contentVersion, mode } = event.data;
    const initial = await step.run('research-and-brief-contract', async () => {
      const { data, error } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('id,status,updated_at,meta')
        .eq('id', queueId)
        .maybeSingle();
      if (error) throw new Error(`blog_queue_read_failed:${error.message}`);
      if (!data) throw new Error('blog_queue_missing');
      if (!['queued', 'pending_review', 'generating'].includes(String(data.status))) {
        return { terminal: true, status: String(data.status), reason: 'queue_not_generation_eligible' };
      }
      return { terminal: false, status: String(data.status), updatedAt: data.updated_at };
    });
    if (initial.terminal) return { ...initial, queueId, contentVersion };

    const generation = await step.run('draft-verify-edit-quality', () => invokeAuthorizedCron(
      `/api/cron/blog-publisher?phase=generate_only&pipelineQueueId=${encodeURIComponent(queueId)}`,
    ));

    const run = await step.run('persisted-quality-decision', async () => {
      const { data, error } = await supabaseAdmin
        .from('blog_generation_runs')
        .select('id,status,content_creative_id,selected_attempt_id,latest_quality_score,disposition,last_error')
        .eq('queue_id', queueId)
        .eq('generation_key', `queue:${queueId}`)
        .maybeSingle();
      if (error) throw new Error(`blog_generation_run_read_failed:${error.message}`);
      if (!data) throw new Error('blog_generation_run_missing_after_generation');
      return data;
    });

    if (mode === 'generate_only' || run.status !== 'approved_for_slot') {
      return {
        queueId,
        contentVersion,
        pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
        generation,
        run,
        publicationDispatched: false,
      };
    }

    const preview = await step.run('browser-preview-gate', async () => {
      if (!run.content_creative_id) {
        return { passed: false as const, reason: 'blog_preview_creative_missing', evidence: null };
      }
      const { data, error } = await supabaseAdmin
        .from('content_creatives')
        .select('generation_meta')
        .eq('id', run.content_creative_id)
        .eq('status', 'draft')
        .maybeSingle();
      if (error) throw new Error(`blog_preview_evidence_read_failed:${error.message}`);
      const evidence = readBlogBrowserPreviewEvidenceV4(data?.generation_meta);
      if (!evidence || !evidence.passed || evidence.score < 95) {
        return { passed: false as const, reason: 'blog_browser_preview_gate_not_passed', evidence };
      }
      return { passed: true as const, reason: null, evidence };
    });

    // A deterministic quality/browser failure is terminal for this content
    // version. Throwing here would make Inngest retry a non-transient failure.
    if (!preview.passed) {
      return {
        queueId,
        contentVersion,
        pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
        generation,
        run,
        preview,
        publicationDispatched: false,
      };
    }

    const publication = await step.run('atomic-publish-and-index-outbox', () => invokeAuthorizedCron(
      `/api/cron/blog-publication-controller?force=true&runId=${encodeURIComponent(String(run.id))}`,
    ));

    return {
      queueId,
      contentVersion,
      pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
      generation,
      run,
      preview,
      publication,
      publicationDispatched: true,
    };
  },
);
