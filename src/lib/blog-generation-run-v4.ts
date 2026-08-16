import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import type { BlogAiUsageReceipt } from './blog-ai-caller';
import {
  blogBudgetDayKstV4,
  resolveBlogDailyAiCostCapUsdV4,
} from './blog-ai-budget-v4';
import type { BlogDeepSeekStage, BlogQualityRouteV4 } from './blog-deepseek-orchestrator-v4';

export interface BlogAiBudgetReservationRecordV4 {
  reservationId: string | null;
  allowed: boolean;
  reason: string;
  budgetDayKst: string;
  capUsd: number;
  actualUsd: number;
  reservedUsd: number;
  requestedUsd: number;
  remainingUsd: number;
}

export interface BlogGenerationAttemptRecordV4 {
  queueId: string;
  tenantId?: string | null;
  attemptNumber: number;
  stage: BlogDeepSeekStage;
  route: BlogQualityRouteV4 | 'failed';
  output: {
    title: string;
    description: string;
    slug: string;
    markdown: string;
    audit?: Record<string, unknown>;
  };
  qualityScore: number;
  hardBlockers: string[];
  failureReasons: string[];
  researchFingerprint?: string | null;
  claimFingerprint?: string | null;
  receipt: BlogAiUsageReceipt;
  attemptStatus?: 'completed' | 'failed';
  errorCode?: string | null;
}

export interface PriorBlogGenerationAttemptV4 {
  attemptNumber: number;
  output: { title?: string; description?: string; slug?: string; markdown?: string };
  researchFingerprint: string | null;
  claimFingerprint: string | null;
  qualityScore: number | null;
}

export async function readLatestBlogGenerationAttemptV4(
  queueId: string,
): Promise<PriorBlogGenerationAttemptV4 | null> {
  const { data, error } = await supabaseAdmin
    .from('blog_generation_attempts')
    .select('attempt_number,output_document,research_fingerprint,claim_fingerprint,quality_score_after')
    .eq('queue_id', queueId)
    // Failed provider calls deliberately persist an empty output document for
    // auditability. They must advance the durable attempt counter, but must
    // never replace the latest usable draft used by the next rewrite.
    .eq('status', 'completed')
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    attemptNumber: Number(data.attempt_number || 0),
    output: (data.output_document || {}) as PriorBlogGenerationAttemptV4['output'],
    researchFingerprint: data.research_fingerprint ?? null,
    claimFingerprint: data.claim_fingerprint ?? null,
    qualityScore: typeof data.quality_score_after === 'number' ? data.quality_score_after : null,
  };
}

/**
 * The reservation is written before the provider call, so it is the durable
 * source of truth when a transport failure occurs before an attempt receipt
 * can be stored. Taking the maximum prevents a retained failed reservation
 * from permanently colliding with the next retry's unique attempt number.
 */
export async function readLatestBlogModelCallAttemptNumberV4(
  queueId: string,
  persistedAttemptNumber = 0,
): Promise<number> {
  const [{ data: attempt }, { data: reservation }] = await Promise.all([
    supabaseAdmin
      .from('blog_generation_attempts')
      .select('attempt_number')
      .eq('queue_id', queueId)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('blog_ai_budget_reservations')
      .select('attempt_number')
      .eq('queue_id', queueId)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return Math.max(
    0,
    Number(persistedAttemptNumber || 0),
    Number(attempt?.attempt_number || 0),
    Number(reservation?.attempt_number || 0),
  );
}

export function nextBlogModelCallAttemptNumberV4(latestAttemptNumber: number): number {
  return Math.min(3, Math.max(0, Math.trunc(latestAttemptNumber)) + 1);
}

/**
 * Atomically reserves daily AI budget before any provider request. The RPC is
 * deliberately fail-closed: an unavailable/missing reservation ledger is not
 * permission to spend outside the cap.
 */
export async function reserveBlogAiBudgetBeforeCallV4(input: {
  queueId: string;
  attemptNumber: number;
  stage: BlogDeepSeekStage;
  provider: 'deepseek' | 'gemini';
  model: string;
  requestedUsd: number;
  now?: Date;
  capUsd?: number;
}): Promise<BlogAiBudgetReservationRecordV4> {
  const budgetDayKst = blogBudgetDayKstV4(input.now);
  const capUsd = input.capUsd ?? resolveBlogDailyAiCostCapUsdV4();
  if (!Number.isFinite(input.requestedUsd) || input.requestedUsd <= 0) {
    return {
      reservationId: null, allowed: false, reason: 'invalid_budget_request',
      budgetDayKst, capUsd, actualUsd: 0, reservedUsd: 0,
      requestedUsd: 0, remainingUsd: 0,
    };
  }
  const { data, error } = await supabaseAdmin.rpc('reserve_blog_ai_budget_v4', {
    p_queue_id: input.queueId,
    p_attempt_number: input.attemptNumber,
    p_stage: input.stage,
    p_provider: input.provider,
    p_model: input.model,
    p_requested_usd: input.requestedUsd,
    p_cap_usd: capUsd,
    p_budget_day_kst: budgetDayKst,
  }).maybeSingle();
  if (error || !data) {
    return {
      reservationId: null, allowed: false,
      reason: `budget_reservation_unavailable:${error?.message || 'empty_response'}`,
      budgetDayKst, capUsd, actualUsd: 0, reservedUsd: 0,
      requestedUsd: input.requestedUsd, remainingUsd: 0,
    };
  }
  const row = data as Record<string, unknown>;
  return {
    reservationId: typeof row.reservation_id === 'string' ? row.reservation_id : null,
    allowed: row.allowed === true,
    reason: typeof row.reason === 'string' ? row.reason : 'daily_ai_cost_cap_reached',
    budgetDayKst,
    capUsd: Number(row.cap_usd ?? capUsd),
    actualUsd: Number(row.actual_usd ?? 0),
    reservedUsd: Number(row.reserved_usd ?? 0),
    requestedUsd: Number(row.requested_usd ?? input.requestedUsd),
    remainingUsd: Number(row.remaining_usd ?? 0),
  };
}

/**
 * Settles a reservation from a durable provider receipt. If actual cost is
 * unknown (currently Gemini), the RPC must retain the full reservation until
 * the KST day closes. This is intentionally conservative.
 */
export async function settleBlogAiBudgetReservationV4(input: {
  reservationId: string;
  receipt?: BlogAiUsageReceipt | null;
  status: 'completed' | 'failed';
}): Promise<string | null> {
  const actualUsd = input.receipt?.estimatedCostUsd
    ?? input.receipt?.deepseekCost?.estimatedCostUsd
    ?? null;
  const { error } = await supabaseAdmin.rpc('settle_blog_ai_budget_v4', {
    p_reservation_id: input.reservationId,
    p_actual_usd: actualUsd,
    p_receipt: input.receipt ?? {},
    p_status: input.status,
    p_retain_reservation: actualUsd == null,
  });
  return error?.message ?? null;
}

export async function recordBlogGenerationAttemptV4(
  input: BlogGenerationAttemptRecordV4,
): Promise<{ runId: string | null; error: string | null }> {
  const generationKey = `queue:${input.queueId}`;
  const now = new Date().toISOString();
  const taskIdempotencyKey = `blog-generation-v4:${input.queueId}`;
  let { data: task } = await supabaseAdmin
    .from('agent_tasks')
    .select('id')
    .eq('idempotency_key', taskIdempotencyKey)
    .maybeSingle();
  if (!task?.id) {
    const inserted = await supabaseAdmin.from('agent_tasks').insert({
      tenant_id: input.tenantId ?? null,
      source: 'blog_generation_v4',
      agent_type: 'blog_orchestrator',
      specialist_id: input.stage,
      performative: 'request',
      risk_level: 'low',
      status: 'running',
      task_context: { queue_id: input.queueId, generation_key: generationKey },
      idempotency_key: taskIdempotencyKey,
      created_by: 'blog-deepseek-orchestrator-v4',
      started_at: now,
    }).select('id').single();
    task = inserted.data;
    if (!task?.id) {
      const reread = await supabaseAdmin.from('agent_tasks')
        .select('id').eq('idempotency_key', taskIdempotencyKey).maybeSingle();
      task = reread.data;
    }
  }
  const { data: run, error: runError } = await supabaseAdmin
    .from('blog_generation_runs')
    .upsert({
      queue_id: input.queueId,
      tenant_id: input.tenantId ?? null,
      agent_task_id: task?.id ?? null,
      generation_key: generationKey,
      status: input.route,
      attempt_count: input.attemptNumber,
      latest_quality_score: input.qualityScore,
      disposition: input.route,
      updated_at: now,
    }, { onConflict: 'queue_id,generation_key' })
    .select('id')
    .single();
  if (runError || !run?.id) return { runId: null, error: runError?.message || 'generation_run_missing' };

  const outputHash = createHash('sha256').update(JSON.stringify(input.output)).digest('hex');
  const cost = input.receipt.deepseekCost;
  const usage = input.receipt.usage;
  const attemptPayload = {
    run_id: run.id,
    queue_id: input.queueId,
    attempt_number: input.attemptNumber,
    stage: input.stage,
    provider: input.receipt.provider,
    model: input.receipt.model,
    thinking_mode: input.receipt.thinkingMode
      ?? (input.stage === 'draft_flash' ? 'disabled' : 'enabled'),
    research_fingerprint: input.researchFingerprint ?? null,
    claim_fingerprint: input.claimFingerprint ?? null,
    output_hash: outputHash,
    output_document: input.output,
    input_tokens: cost?.inputTokens ?? usage?.inputTokens ?? null,
    cache_hit_input_tokens: cost?.cacheHitInputTokens ?? usage?.cachedInputTokens ?? null,
    cache_miss_input_tokens: cost?.cacheMissInputTokens
      ?? (usage ? Math.max(0, usage.inputTokens - usage.cachedInputTokens) : null),
    output_tokens: cost?.outputTokens ?? usage?.outputTokens ?? null,
    estimated_cost_usd: input.receipt.estimatedCostUsd ?? cost?.estimatedCostUsd ?? null,
    pricing_tier: cost?.pricing.tier ?? null,
    pricing_version: cost?.pricing.version ?? null,
    quality_score_after: input.qualityScore,
    hard_blockers: input.hardBlockers,
    failure_reasons: input.failureReasons,
    route: input.route,
    latency_ms: input.receipt.latencyMs,
    finish_reason: input.receipt.finishReason,
    status: input.attemptStatus ?? 'completed',
    error_code: input.errorCode ?? null,
    completed_at: input.receipt.completedAt || now,
  };
  const { data: insertedAttempt, error: attemptError } = await supabaseAdmin
    .from('blog_generation_attempts')
    .insert(attemptPayload)
    .select('id')
    .single();
  let selectedAttemptId = insertedAttempt?.id ?? null;
  let attemptPersistenceError = attemptError?.message ?? null;
  if (attemptError?.code === '23505') {
    const { data: existingAttempt, error: existingAttemptError } = await supabaseAdmin
      .from('blog_generation_attempts')
      .select('id,output_hash')
      .eq('run_id', run.id)
      .eq('attempt_number', input.attemptNumber)
      .maybeSingle();
    attemptPersistenceError = existingAttemptError?.message
      ?? (existingAttempt?.output_hash === outputHash ? null : 'generation_attempt_number_conflict');
    selectedAttemptId = attemptPersistenceError ? null : existingAttempt?.id ?? null;
  }
  if (!attemptPersistenceError && !selectedAttemptId) {
    attemptPersistenceError = 'generation_attempt_id_missing';
  }
  if (!attemptPersistenceError && input.route === 'approved_for_slot') {
    const { error: selectAttemptError } = await supabaseAdmin
      .from('blog_generation_runs')
      .update({ selected_attempt_id: selectedAttemptId, updated_at: new Date().toISOString() })
      .eq('id', run.id);
    attemptPersistenceError = selectAttemptError?.message ?? null;
  }
  if (attemptPersistenceError) {
    await supabaseAdmin.from('blog_generation_runs').update({
      status: 'failed',
      disposition: 'attempt_persistence_failed',
      last_error: attemptPersistenceError,
      updated_at: new Date().toISOString(),
    }).eq('id', run.id);
    if (task?.id) {
      await supabaseAdmin.from('agent_tasks').update({
        specialist_id: input.stage,
        status: 'failed',
        result_payload: { run_id: run.id, attempt: input.attemptNumber, route: input.route },
        last_error: attemptPersistenceError,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);
    }
    return { runId: run.id, error: attemptPersistenceError };
  }
  if (task?.id) {
    const terminal = input.route === 'approved_for_slot' || input.route === 'human_review' || input.route === 'quarantine';
    await supabaseAdmin.from('agent_tasks').update({
      specialist_id: input.stage,
      status: input.route === 'quarantine' ? 'failed' : terminal ? 'done' : 'running',
      result_payload: {
        run_id: run.id,
        attempt: input.attemptNumber,
        route: input.route,
        score: input.qualityScore,
      },
      last_error: input.route === 'quarantine' ? input.failureReasons.join(',') || 'quality_quarantine' : null,
      completed_at: terminal ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', task.id);
  }
  return { runId: run.id, error: null };
}

export async function approveBlogGenerationRunForSlotV4(input: {
  queueId: string;
  creativeId: string;
  scheduledPublishAt: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('blog_generation_runs')
    .update({
      content_creative_id: input.creativeId,
      status: 'approved_for_slot',
      disposition: 'approved_for_slot',
      approved_at: new Date().toISOString(),
      scheduled_publish_at: input.scheduledPublishAt,
      updated_at: new Date().toISOString(),
    })
    .eq('queue_id', input.queueId)
    .eq('generation_key', `queue:${input.queueId}`)
    .eq('status', 'approved_for_slot')
    .not('selected_attempt_id', 'is', null)
    .select('id')
    .maybeSingle();
  return error?.message ?? (data?.id ? null : 'approved_generation_run_not_found');
}

export async function markBlogGenerationRunForHumanReviewV4(input: {
  queueId: string;
  creativeId: string;
  reason: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('blog_generation_runs')
    .update({
      content_creative_id: input.creativeId,
      status: 'human_review',
      disposition: 'human_review',
      scheduled_publish_at: null,
      last_error: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('queue_id', input.queueId)
    .eq('generation_key', `queue:${input.queueId}`)
    .in('status', ['approved_for_slot', 'human_review'])
    .select('id')
    .maybeSingle();
  return error?.message ?? (data?.id ? null : 'generation_run_human_review_transition_failed');
}
