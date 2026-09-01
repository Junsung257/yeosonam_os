import { blogPipelineRequestedEvent, inngest } from '../client';
import { isInngestBlogAutopilotEnabled } from '@/inngest/runtime-policy';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseAdminConfigured } from '@/lib/supabase';
import { BLOG_AUTOPILOT_PIPELINE_VERSION } from '@/lib/blog-autopilot-v4-contract';
import {
  buildBlogPipelineObservationV4,
  readBlogGenerationArtifactsV4,
  readBlogPipelineCandidateV4,
  readBlogQualityAndPreviewGatesV4,
} from '@/lib/blog-autopilot-stage-services-v4';

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

    const { queueId, contentVersion } = event.data;
    const initial = await step.run('research', async () => {
      const candidate = await readBlogPipelineCandidateV4(queueId);
      return candidate.eligible
        ? { terminal: false, status: String(candidate.status), researchPersisted: candidate.researchPersisted }
        : { terminal: true, status: String(candidate.status), reason: 'queue_not_generation_eligible' };
    });
    if (initial.terminal) return { ...initial, queueId, contentVersion };

    const brief = await step.run('brief', async () => {
      const candidate = await readBlogPipelineCandidateV4(queueId);
      return { topic: candidate.topic, destination: candidate.destination, primaryKeyword: candidate.primary_keyword };
    });

    const generation = await step.run('draft', () => invokeAuthorizedCron(
      `/api/cron/blog-publisher?phase=generate_only&pipelineQueueId=${encodeURIComponent(queueId)}`,
    ));

    const verified = await step.run('verify', () => readBlogGenerationArtifactsV4(queueId));
    const edited = await step.run('edit', async () => ({
      selectedAttemptId: verified.run.selected_attempt_id,
      route: verified.attempt?.route ?? null,
      claimPacketHash: verified.attempt?.claim_packet_hash ?? verified.attempt?.claim_fingerprint ?? null,
      promptTraceComplete: Boolean(
        verified.attempt?.prompt_hash
        && verified.attempt?.prompt_template_version
        && verified.attempt?.prompt_trace_version
      ),
      hardBlockers: verified.attempt?.hard_blockers ?? [],
    }));
    const gates = await step.run('quality', () => readBlogQualityAndPreviewGatesV4(verified.run.content_creative_id));
    const preview = await step.run('preview', async () => ({
      passed: gates.passed,
      reason: gates.reason,
      evidence: gates.preview,
    }));

    if (verified.run.status !== 'approved_for_slot' || !verified.researchPersisted || !gates.passed) {
      return {
        queueId,
        contentVersion,
        pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
        brief,
        generation,
        run: verified.run,
        edited,
        preview,
        publicationDispatched: false,
      };
    }

    const publication = await step.run('publish', async () => ({
      queuedForScheduledSlot: true,
      runId: verified.run.id,
      scheduledPublishAt: verified.run.scheduled_publish_at,
      controller: 'blog-publication-controller',
    }));
    const indexing = await step.run('indexing', async () => ({
      state: 'deferred_until_atomic_publication',
      outboxCreatedBy: 'blog-publication-controller',
    }));
    const observation = await step.run('observe', async () => buildBlogPipelineObservationV4({
      queueId,
      contentVersion,
      runId: String(verified.run.id),
    }));

    return {
      queueId,
      contentVersion,
      pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
      generation,
      brief,
      run: verified.run,
      edited,
      preview,
      publication,
      indexing,
      observation,
      publicationDispatched: false,
      publicationQueuedForScheduledSlot: true,
    };
  },
);
