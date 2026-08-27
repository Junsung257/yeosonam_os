import type { SupabaseClient } from '@supabase/supabase-js';
import { FatalError, RetryableError, getWorkflowMetadata } from 'workflow';

import { validateBlogPackageSnapshotPinV4 } from '@/lib/blog-content-factory/package-snapshot';
import { decideBlogContentGenerationPassV4 } from '@/lib/blog-content-factory/generation-loop';
import {
  bindBlogContentOperationWorkflowV4,
  recordBlogContentOperationStageV4,
  terminalizeBlogContentOperationV4,
} from '@/lib/blog-content-factory/repository';
import {
  isBlogPublisherOperationResponseV4,
  type BlogPublisherOperationResponseV4,
} from '@/lib/blog-content-factory/publisher-response';
import type {
  BlogContentOperationWorkflowInput,
  BlogPackageSnapshotPinV4,
} from '@/lib/blog-content-factory/types';
import { isDeepSeekOffPeakAt } from '@/lib/blog-deepseek-orchestrator-v4';
import { buildQueuedInformationBrief, evaluateQueuedInformationResearch } from '@/lib/blog-queue-research';
import { researchBlogInformationAutomatically } from '@/lib/blog-auto-research';
import { BLOG_INFORMATION_RESEARCH_META_KEY } from '@/lib/blog-generation-research';
import { isHighRiskAutoDiscardTopic } from '@/lib/blog-publication-review-policy';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

type OperationRow = {
  id: string;
  queue_id: string | null;
  status: string;
  current_stage: string;
  fencing_token: number;
  lease_owner: string | null;
  demand_cluster_id: string;
  operation_type: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  package_id: string | null;
  package_snapshot_id: string | null;
  package_snapshot_revision: number | null;
  package_snapshot_hash: string | null;
};

type QueueRow = {
  id: string;
  status: string;
  topic: string | null;
  destination: string | null;
  primary_keyword: string | null;
  category: string | null;
  source: string | null;
  angle_type: string | null;
  product_id: string | null;
  content_creative_id: string | null;
  meta: Record<string, unknown> | null;
};

function db(): SupabaseClient {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new FatalError('BLOG_CONTENT_FACTORY_SUPABASE_ADMIN_MISSING');
  return supabase as SupabaseClient;
}

function isTransient(message: string): boolean {
  return /timeout|temporar|connection|network|fetch failed|econn|5\d\d|rate.?limit|unavailable/i.test(message);
}

async function operationAndQueue(input: BlogContentOperationWorkflowInput): Promise<{
  operation: OperationRow;
  queue: QueueRow;
}> {
  const supabase = db();
  const [{ data: operation, error: operationError }, { data: queue, error: queueError }] = await Promise.all([
    supabase
      .from('blog_content_operations')
      .select('id,queue_id,status,current_stage,fencing_token,lease_owner,demand_cluster_id,operation_type,risk_level,package_id,package_snapshot_id,package_snapshot_revision,package_snapshot_hash')
      .eq('id', input.operationId)
      .maybeSingle(),
    supabase
      .from('blog_topic_queue')
      .select('id,status,topic,destination,primary_keyword,category,source,angle_type,product_id,content_creative_id,meta')
      .eq('id', input.queueId)
      .maybeSingle(),
  ]);
  if (operationError || queueError) {
    const message = operationError?.message || queueError?.message || 'unknown';
    throw new RetryableError(`BLOG_CONTENT_FACTORY_PREFLIGHT_DB:${message}`, { retryAfter: '15s' });
  }
  if (!operation || !queue) throw new FatalError('BLOG_CONTENT_FACTORY_LINEAGE_MISSING');
  const typedOperation = operation as unknown as OperationRow;
  const typedQueue = queue as unknown as QueueRow;
  if (typedOperation.queue_id !== input.queueId
    || Number(typedOperation.fencing_token) !== input.fencingToken
    || typedOperation.lease_owner !== input.leaseOwner
    || !['running', 'publishing'].includes(typedOperation.status)) {
    throw new FatalError('BLOG_CONTENT_FACTORY_FENCING_OR_LINEAGE_MISMATCH');
  }
  return { operation: typedOperation, queue: typedQueue };
}

async function bindWorkflowStep(input: BlogContentOperationWorkflowInput, workflowRunId: string) {
  'use step';
  await bindBlogContentOperationWorkflowV4({
    supabase: db(),
    operationId: input.operationId,
    fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner,
    workflowRunId,
  });
}

async function preflightStep(input: BlogContentOperationWorkflowInput) {
  'use step';
  const { operation, queue } = await operationAndQueue(input);
  const highRiskTopic = isHighRiskAutoDiscardTopic({
    title: queue.topic,
    category: queue.category,
    topic: queue.primary_keyword,
  });
  if (operation.risk_level === 'HIGH' || highRiskTopic) {
    await terminalizeBlogContentOperationV4({
      supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
      leaseOwner: input.leaseOwner, eventKey: 'preflight:high-risk:auto-discard:v2', stage: 'quarantined',
      status: 'quarantined', failureCode: 'high_risk_auto_discarded', skipReason: 'high_risk_auto_discarded',
      evidence: {
        riskLevel: operation.risk_level,
        topicClassifierMatched: highRiskTopic,
        operationState: {
          generationStatus: 'skipped',
          reviewStatus: 'not_required',
          publicationStatus: 'suppressed_by_policy',
          indexingStatus: 'not_attempted',
        },
      },
    });
    return { terminal: true as const, outcome: 'quarantined' as const };
  }
  if (queue.status !== 'queued') throw new FatalError(`BLOG_CONTENT_FACTORY_QUEUE_NOT_QUEUED:${queue.status}`);
  const { data: signals, error } = await db()
    .from('blog_demand_cluster_signals')
    .select('id,provider,verified_at,expires_at')
    .eq('cluster_id', operation.demand_cluster_id)
    .order('observed_at', { ascending: false })
    .limit(20);
  if (error) throw new RetryableError(`BLOG_CONTENT_FACTORY_DEMAND_READ:${error.message}`, { retryAfter: '15s' });
  const now = Date.now();
  const verified = (signals ?? []).filter((signal) => (
    Boolean(signal.verified_at)
    && (!signal.expires_at || Date.parse(String(signal.expires_at)) > now)
  ));
  if (verified.length === 0) throw new FatalError('BLOG_CONTENT_FACTORY_VERIFIED_DEMAND_MISSING');
  await recordBlogContentOperationStageV4({
    supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner, eventKey: 'preflight:demand-verified:v1', stage: 'demand_verified',
    eventStatus: 'succeeded', evidence: { verifiedSignalCount: verified.length, providers: [...new Set(verified.map((row) => row.provider))] },
  });
  return { terminal: false as const, operation, queue };
}

async function packageSnapshotStep(input: BlogContentOperationWorkflowInput) {
  'use step';
  const { operation } = await operationAndQueue(input);
  if (!['new_commercial', 'product_refresh'].includes(operation.operation_type)) {
    return { required: false as const };
  }
  if (!operation.package_id || !operation.package_snapshot_id
    || operation.package_snapshot_revision == null || !operation.package_snapshot_hash) {
    throw new FatalError('BLOG_CONTENT_FACTORY_PACKAGE_SNAPSHOT_PIN_MISSING');
  }
  const supabase = db();
  const [{ data: pointer, error: pointerError }, { data: snapshot, error: snapshotError }] = await Promise.all([
    supabase.from('product_registration_v5_publication_pointers')
      .select('package_id,current_snapshot_id,current_revision_id,state')
      .eq('package_id', operation.package_id).eq('channel', 'customer').eq('locale', 'ko-KR').maybeSingle(),
    supabase.from('public_package_snapshots')
      .select('id,package_id,package_revision,snapshot_hash,status')
      .eq('id', operation.package_snapshot_id).maybeSingle(),
  ]);
  if (pointerError || snapshotError) {
    throw new RetryableError(`BLOG_CONTENT_FACTORY_PACKAGE_SNAPSHOT_READ:${pointerError?.message || snapshotError?.message}`, { retryAfter: '30s' });
  }
  const pin: BlogPackageSnapshotPinV4 = {
    packageId: operation.package_id,
    snapshotId: operation.package_snapshot_id,
    revision: operation.package_snapshot_revision,
    hash: operation.package_snapshot_hash,
  };
  const validation = validateBlogPackageSnapshotPinV4({ pin, pointer: pointer as never, snapshot: snapshot as never });
  if (!validation.valid) throw new FatalError(`BLOG_CONTENT_FACTORY_${validation.reason?.toUpperCase()}`);
  return { required: true as const, pin };
}

async function briefStep(input: BlogContentOperationWorkflowInput) {
  'use step';
  const { queue } = await operationAndQueue(input);
  const brief = buildQueuedInformationBrief(queue);
  if (!brief.passed) throw new FatalError(`BLOG_CONTENT_FACTORY_BRIEF_INVALID:${brief.issues.join(',')}`);
  await recordBlogContentOperationStageV4({
    supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner, eventKey: 'brief:verified:v1', stage: 'brief_verified',
    eventStatus: 'succeeded', evidence: {
      intent: brief.intentType,
      primaryDecision: brief.readerQuestion,
      primarySourcesRequired: brief.sourcePolicy.primarySourcesRequired,
      requiresHumanReview: brief.requiresHumanReview,
    },
  });
  return { intent: brief.intentType, primaryDecision: brief.readerQuestion };
}

async function researchStep(input: BlogContentOperationWorkflowInput) {
  'use step';
  const { queue } = await operationAndQueue(input);
  const result = evaluateQueuedInformationResearch(queue);
  if (!result.passed) {
    await recordBlogContentOperationStageV4({
      supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
      leaseOwner: input.leaseOwner, eventKey: 'research:backlog:v1', stage: 'research_backlog',
      eventStatus: 'skipped', operationStatus: 'research_backlog', failureCode: 'research_not_ready',
      evidence: { issues: result.issues.slice(0, 20) },
    });
    return { ready: false as const, issues: result.issues };
  }
  await recordBlogContentOperationStageV4({
    supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner, eventKey: 'research:ready:v1', stage: 'research_ready',
    eventStatus: 'succeeded', evidence: { verified: true },
  });
  return { ready: true as const, issues: [] as string[] };
}

async function generationStep(input: BlogContentOperationWorkflowInput, pass: number) {
  'use step';
  await recordBlogContentOperationStageV4({
    supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner, eventKey: `generation:pass:${pass}:started:v1`,
    stage: pass === 1 ? 'drafting' : 'repairing', eventStatus: 'started',
  });
  if (!isDeepSeekOffPeakAt(new Date())) {
    throw new RetryableError('BLOG_CONTENT_FACTORY_WAITING_FOR_DEEPSEEK_OFFPEAK', {
      retryAfter: '30m',
    });
  }
  const secret = getSecret('CRON_SECRET');
  if (!secret) throw new FatalError('BLOG_CONTENT_FACTORY_CRON_SECRET_MISSING');
  const url = new URL('/api/cron/blog-publisher', input.requestBaseUrl);
  url.searchParams.set('operationId', input.operationId);
  url.searchParams.set('fencingToken', String(input.fencingToken));
  url.searchParams.set('leaseOwner', input.leaseOwner);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET', cache: 'no-store', headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(280_000),
    });
  } catch (error) {
    throw new RetryableError(`BLOG_CONTENT_FACTORY_GENERATION_FETCH:${error instanceof Error ? error.message : String(error)}`, { retryAfter: '45s' });
  }
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    reason?: string;
    results?: Array<{ status?: string; reason?: string }>;
  } | null;
  if (!response.ok || !payload) {
    const reason = payload?.reason || `http_${response.status}`;
    if (response.status >= 500 || isTransient(reason)) {
      throw new RetryableError(`BLOG_CONTENT_FACTORY_GENERATION_TRANSIENT:${reason}`, { retryAfter: '45s' });
    }
    throw new FatalError(`BLOG_CONTENT_FACTORY_GENERATION_CONTRACT:${reason}`);
  }
  const result = payload.results?.[0];
  if (!result?.status) throw new FatalError('BLOG_CONTENT_FACTORY_GENERATION_RESULT_MISSING');
  const passDecision = decideBlogContentGenerationPassV4({
    status: result.status,
    completedPasses: pass,
  });
  if (passDecision === 'retry') {
    throw new RetryableError(`BLOG_CONTENT_FACTORY_GENERATION_DEFERRED:${result.reason || result.status}`, {
      retryAfter: '5m',
    });
  }
  if (result.status === 'error' && isTransient(result.reason || '')) {
    throw new RetryableError(`BLOG_CONTENT_FACTORY_GENERATION_RESULT_TRANSIENT:${result.reason}`, {
      retryAfter: '45s',
    });
  }
  return { status: result.status, reason: result.reason ?? null, passDecision };
}

/**
 * Paid model calls are capped at Flash 1 + Pro 1 by the AI Control Plane.
 * Durable passes 3–5 therefore only re-read the selected run and record a
 * bounded validation/review event; they must never call the provider again.
 */
async function deterministicValidationStep(input: BlogContentOperationWorkflowInput, pass: number) {
  'use step';
  await operationAndQueue(input);
  const { data: run, error } = await db()
    .from('blog_generation_runs')
    .select('id,status,selected_attempt_id,latest_quality_score')
    .eq('queue_id', input.queueId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new RetryableError(`BLOG_CONTENT_FACTORY_VALIDATION_READ:${error.message}`, { retryAfter: '15s' });
  if (!run?.id) throw new FatalError('BLOG_CONTENT_FACTORY_VALIDATION_RUN_MISSING');
  if (run.status === 'approved_for_slot' && run.selected_attempt_id) {
    await recordBlogContentOperationStageV4({
      supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
      leaseOwner: input.leaseOwner, eventKey: `validation:pass:${pass}:approved:v1`, stage: 'evaluating',
      eventStatus: 'succeeded', operationStatus: 'approved_for_slot', generationRunId: String(run.id),
      evidence: { paidModelCalls: 2, qualityScore: run.latest_quality_score ?? null },
    });
    return { status: 'approved_for_slot', reason: null, passDecision: 'finalize' as const };
  }
  const qualityBlocked = ['pending_review', 'human_review'].includes(String(run.status))
    || Number(run.latest_quality_score ?? 0) < 90;
  const status = 'quarantined' as const;
  await terminalizeBlogContentOperationV4({
    supabase: db(), operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner, eventKey: `validation:pass:${pass}:bounded:v2:${workflowRunId}`,
    stage: 'quarantined', status,
    generationRunId: String(run.id), failureCode: qualityBlocked
      ? 'quality_gate_failed_after_bounded_repair'
      : 'model_output_not_publishable',
    skipReason: qualityBlocked ? 'quality_gate_failed_after_bounded_repair' : 'model_output_not_publishable',
    evidence: {
      paidModelCalls: 2,
      latestRunStatus: run.status,
      qualityScore: run.latest_quality_score ?? null,
      deterministicRepairOnly: true,
      operationState: {
        generationStatus: 'failed',
        reviewStatus: 'not_required',
        publicationStatus: 'suppressed_by_policy',
        indexingStatus: 'not_attempted',
      },
    },
  });
  return {
    status,
    reason: qualityBlocked ? 'quality_gate_failed_after_bounded_repair' : 'model_output_not_publishable',
    passDecision: 'finalize' as const,
  };
}

async function finalizeStep(
  input: BlogContentOperationWorkflowInput,
  generation: { status: string; reason: string | null },
  workflowRunId: string,
) {
  'use step';
  const supabase = db();
  const { data: run, error } = await supabase
    .from('blog_generation_runs')
    .select('id,content_creative_id,status,selected_attempt_id,latest_quality_score,updated_at')
    .eq('queue_id', input.queueId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new RetryableError(`BLOG_CONTENT_FACTORY_RUN_READ:${error.message}`, { retryAfter: '15s' });

  if (run?.id) {
    const { data: attempts, error: attemptsError } = await supabase
      .from('blog_generation_attempts')
      .select('attempt_number,stage,status,error_code,provider,model,input_tokens,cache_hit_input_tokens,output_tokens,estimated_cost_usd,latency_ms,quality_score_before,quality_score_after,route,hard_blockers,failure_reasons')
      .eq('run_id', run.id)
      .order('attempt_number', { ascending: true });
    if (attemptsError) {
      throw new RetryableError(`BLOG_CONTENT_FACTORY_ATTEMPT_RECEIPT_READ:${attemptsError.message}`, { retryAfter: '15s' });
    }
    for (const attempt of attempts ?? []) {
      const attemptNumber = Number(attempt.attempt_number);
      if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 5) continue;
      await recordBlogContentOperationStageV4({
        supabase,
        operationId: input.operationId,
        fencingToken: input.fencingToken,
        leaseOwner: input.leaseOwner,
        eventKey: `generation:attempt:${attemptNumber}:v1`,
        stage: attempt.stage === 'draft_flash' ? 'drafting' : 'repairing',
        eventStatus: attempt.status === 'completed' ? 'succeeded' : 'failed',
        failureCode: attempt.error_code ? String(attempt.error_code) : null,
        evidence: {
          route: attempt.route,
          qualityScoreBefore: attempt.quality_score_before,
          qualityScoreAfter: attempt.quality_score_after,
          hardBlockerCount: Array.isArray(attempt.hard_blockers) ? attempt.hard_blockers.length : 0,
          failureReasonCount: Array.isArray(attempt.failure_reasons) ? attempt.failure_reasons.length : 0,
        },
        receipt: {
          provider: 'deepseek',
          model: String(attempt.model || ''),
          attemptNumber,
          inputTokens: Number(attempt.input_tokens ?? 0),
          cachedInputTokens: Number(attempt.cache_hit_input_tokens ?? 0),
          outputTokens: Number(attempt.output_tokens ?? 0),
          estimatedCostUsd: Number(attempt.estimated_cost_usd ?? 0),
          durationMs: Number(attempt.latency_ms ?? 0),
        },
      });
    }
  }

  if (generation.status === 'approved_for_slot'
    && run?.status === 'approved_for_slot'
    && run.selected_attempt_id
    && Number(run.latest_quality_score ?? 0) >= 90) {
    await recordBlogContentOperationStageV4({
      supabase, operationId: input.operationId, fencingToken: input.fencingToken,
      leaseOwner: input.leaseOwner, eventKey: 'finalize:approved:v1', stage: 'approved_for_slot',
      eventStatus: 'succeeded', operationStatus: 'approved_for_slot',
      generationRunId: String(run.id), creativeId: run.content_creative_id ? String(run.content_creative_id) : null,
      evidence: { selectedAttemptId: run.selected_attempt_id, qualityScore: run.latest_quality_score },
    });
    return { outcome: 'approved_for_slot' as const, generationRunId: String(run.id) };
  }

  await terminalizeBlogContentOperationV4({
    supabase, operationId: input.operationId, fencingToken: input.fencingToken,
    leaseOwner: input.leaseOwner,
    eventKey: `finalize:quarantined:v2:${workflowRunId}`,
    stage: 'quarantined',
    status: 'quarantined',
    failureCode: generation.reason || `generation_status_${generation.status}`,
    skipReason: generation.reason || `generation_status_${generation.status}`,
    generationRunId: run?.id ? String(run.id) : null,
    creativeId: run?.content_creative_id ? String(run.content_creative_id) : null,
    evidence: {
      generationStatus: generation.status,
      generationReason: generation.reason,
      operationState: {
        generationStatus: 'failed',
        reviewStatus: 'not_required',
        publicationStatus: 'suppressed_by_policy',
        indexingStatus: 'not_attempted',
      },
    },
  });
  return { outcome: 'quarantined' as const, generationRunId: run?.id ? String(run.id) : null };
}

export async function blogContentOperationWorkflow(
  input: BlogContentOperationWorkflowInput,
) {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  await bindWorkflowStep(input, workflowRunId);
  const preflight = await preflightStep(input);
  if (preflight.terminal) return { outcome: preflight.outcome, operationId: input.operationId };
  await packageSnapshotStep(input);
  await briefStep(input);
  const research = await researchStep(input);
  if (!research.ready) return { outcome: 'research_backlog' as const, operationId: input.operationId };
  let generation: Awaited<ReturnType<typeof generationStep>> | null = null;
  for (let pass = 1; pass <= 5; pass += 1) {
    generation = pass <= 2
      ? await generationStep(input, pass)
      : await deterministicValidationStep(input, pass);
    if (generation.passDecision !== 'continue') break;
  }
  if (!generation) throw new FatalError('BLOG_CONTENT_FACTORY_GENERATION_NOT_STARTED');
  const final = await finalizeStep(input, generation, workflowRunId);
  return { ...final, operationId: input.operationId };
}
