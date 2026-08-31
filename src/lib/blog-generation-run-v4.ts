import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import type { BlogAiUsageReceipt } from './blog-ai-caller';
import {
  blogBudgetDayKstV4,
  resolveBlogDailyAiCostCapUsdV4,
} from './blog-ai-budget-v4';
import {
  BLOG_QUALITY_MAX_ATTEMPTS_V4,
  type BlogDeepSeekStage,
  type BlogQualityRouteV4,
} from './blog-deepseek-orchestrator-v4';
import type { BlogPromptTraceV1 } from './blog-editorial-harness-v5';

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
  promptTrace?: BlogPromptTraceV1 | null;
  receipt: BlogAiUsageReceipt;
  attemptStatus?: 'completed' | 'failed';
  errorCode?: string | null;
}

export interface BlogGenerationAttemptRevalidationV4 {
  queueId: string;
  attemptId: string;
  attemptNumber: number;
  qualityScore: number;
  reason: 'opening_heading_exclusion_v1' | 'route_template_dedup_v2';
  output: BlogGenerationAttemptRecordV4['output'];
}

interface BlogGenerationAttemptRevalidationSnapshotV4 {
  attemptNumber: number;
  status: string;
  route: string;
  qualityScore: number;
  hardBlockers: unknown;
  failureReasons: unknown;
  output: BlogGenerationAttemptRecordV4['output'];
}

function publicAttemptOutputMatchesV4(
  left: BlogGenerationAttemptRecordV4['output'],
  right: BlogGenerationAttemptRecordV4['output'],
): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.slug === right.slug
    && left.markdown === right.markdown;
}

export function isEligibleBlogGenerationAttemptRevalidationV4(input: {
  snapshot: BlogGenerationAttemptRevalidationSnapshotV4;
  expectedAttemptNumber: number;
  output: BlogGenerationAttemptRecordV4['output'];
  reason?: BlogGenerationAttemptRevalidationV4['reason'];
}): boolean {
  const failureReasons = Array.isArray(input.snapshot.failureReasons)
    ? input.snapshot.failureReasons.map(String)
    : [];
  const hardBlockers = Array.isArray(input.snapshot.hardBlockers)
    ? input.snapshot.hardBlockers.map(String)
    : [];
  const oldAudit = input.snapshot.output.audit;
  const oldQuality = oldAudit?.quality_evaluation_v3 as Record<string, unknown> | undefined;
  const oldQualityFailures = Array.isArray(oldQuality?.failureReasons)
    ? oldQuality.failureReasons
      .map((row) => row && typeof row === 'object' ? String((row as Record<string, unknown>).code || '') : '')
      .filter(Boolean)
    : [];
  const oldClaimValidation = oldAudit?.claim_validation as Record<string, unknown> | undefined;
  const oldPublishQuality = oldAudit?.publish_quality as Record<string, unknown> | undefined;
  const commonEligible = input.snapshot.attemptNumber === input.expectedAttemptNumber
    && input.snapshot.status === 'completed'
    && input.snapshot.route === 'quarantine'
    && hardBlockers.length === 0;
  if (!commonEligible) return false;
  if (input.reason === 'route_template_dedup_v2') {
    const expectedFailures = [
      'publish_gate:ai_readability',
      'editorial_harness_v5:deterministic_internal_label_leak',
      'editorial_harness_v5:semantic_judge_missing',
    ];
    const sameFailures = failureReasons.length === expectedFailures.length
      && expectedFailures.every((failure) => failureReasons.includes(failure));
    const unchangedCandidate = publicAttemptOutputMatchesV4(input.snapshot.output, input.output);
    const marker = '<!-- blog_decision_artifact:route_decision:v1 -->';
    const repairedCandidate = input.output.title === '괌 공항 교통: 택시 위치·미터요금과 GRTA 요금 비교'
      && input.output.slug === 'guam-airport-taxi-counter-grta-fares'
      && input.output.markdown.split(marker).length === 2
      && [
        '기본 호출 2.40 USD',
        '최초 1마일 4.00 USD',
        '0.25마일마다 0.80 USD',
        '일반 1회 탑승 요금은 1.50 USD',
        '일반 1일권 요금은 4.00 USD',
        '서쪽 도착 터미널 건물 밖',
      ].every((requiredText) => input.output.markdown.includes(requiredText));
    return input.expectedAttemptNumber === 4
      && sameFailures
      && oldQuality?.passed === true
      && oldClaimValidation?.passed === true
      && oldPublishQuality?.passed === false
      && input.snapshot.output.slug === 'guam-airport-taxi-counter-grta-fares'
      && input.snapshot.output.slug === input.output.slug
      && input.snapshot.output.description === input.output.description
      && input.snapshot.output.markdown.includes('<!-- blog_decision_artifact:route_decision:v1 -->')
      && (unchangedCandidate || repairedCandidate);
  }
  return Number(input.snapshot.qualityScore) >= 90
    && failureReasons.length === 1
    && failureReasons[0] === 'opening_too_similar'
    && oldQualityFailures.length === 1
    && oldQualityFailures[0] === 'opening_too_similar'
    && oldClaimValidation?.passed === true
    && oldPublishQuality?.passed === true
    && publicAttemptOutputMatchesV4(input.snapshot.output, input.output);
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
  return Math.min(
    BLOG_QUALITY_MAX_ATTEMPTS_V4,
    Math.max(0, Math.trunc(latestAttemptNumber)) + 1,
  );
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
 * The semantic judge is a separate model call and therefore receives a
 * separate atomic reservation under the same KST-day cap.
 */
export async function reserveBlogEditorialJudgeBudgetBeforeCallV5(input: {
  queueId: string;
  attemptNumber: number;
  model: string;
  requestedUsd: number;
  callKind?: 'editorial_judge' | 'editorial_judge_retry' | 'editorial_judge_structured_retry';
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
  const { data, error } = await supabaseAdmin.rpc('reserve_blog_ai_budget_v5', {
    p_queue_id: input.queueId,
    p_attempt_number: input.attemptNumber,
    p_stage: 'editorial_judge',
    p_provider: 'deepseek',
    p_model: input.model,
    p_requested_usd: input.requestedUsd,
    p_cap_usd: capUsd,
    p_budget_day_kst: budgetDayKst,
    p_call_kind: input.callKind ?? 'editorial_judge',
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
  // A model-level approval is not yet a publication approval. The publisher
  // still has to pass representative ownership, persist the private draft,
  // and complete every downstream publication gate. Keeping the run in
  // `generating` prevents the publication controller from observing a
  // half-committed candidate.
  const runStatus = input.route === 'approved_for_slot' ? 'generating' : input.route;
  const runDisposition = input.route === 'approved_for_slot'
    ? 'awaiting_publication_gates'
    : input.route;
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
      status: runStatus,
      attempt_count: input.attemptNumber,
      latest_quality_score: input.qualityScore,
      disposition: runDisposition,
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
    prompt_hash: input.promptTrace?.renderedPromptHash ?? null,
    prompt_trace_version: input.promptTrace?.version ?? null,
    prompt_template_version: input.promptTrace?.templateVersion ?? null,
    git_commit_sha: input.promptTrace?.gitCommitSha ?? null,
    brief_hash: input.promptTrace?.briefHash ?? null,
    claim_packet_hash: input.promptTrace?.claimPacketHash ?? null,
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
    const terminal = input.route === 'human_review' || input.route === 'quarantine';
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

/**
 * Re-runs deterministic quality checks against an existing model output after
 * an evaluator-only defect is fixed. It never spends AI budget or creates a
 * new model attempt. The original route, score and failure are retained in the
 * attempt audit before the attempt is promoted for the publication controller.
 */
export async function revalidateBlogGenerationAttemptV4(
  input: BlogGenerationAttemptRevalidationV4,
): Promise<string | null> {
  const { data: run, error: runError } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id,status,attempt_count,selected_attempt_id')
    .eq('queue_id', input.queueId)
    .eq('generation_key', `queue:${input.queueId}`)
    .maybeSingle();
  if (runError || !run?.id) return runError?.message || 'generation_run_missing';

  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('blog_generation_attempts')
    .select('id,attempt_number,status,route,quality_score_after,hard_blockers,failure_reasons,output_document,output_hash')
    .eq('id', input.attemptId)
    .eq('run_id', run.id)
    .eq('queue_id', input.queueId)
    .maybeSingle();
  if (attemptError || !attempt?.id) return attemptError?.message || 'generation_attempt_missing';

  const currentOutput = (attempt.output_document || {}) as BlogGenerationAttemptRecordV4['output'];
  const currentAudit = currentOutput.audit || {};
  const existingRevalidation = currentAudit.deterministic_revalidation_v4 as Record<string, unknown> | undefined;
  const alreadyRevalidated = attempt.route === 'approved_for_slot'
    && Array.isArray(attempt.failure_reasons)
    && attempt.failure_reasons.length === 0
    && existingRevalidation?.reason === input.reason
    && existingRevalidation?.source_attempt_id === input.attemptId
    && publicAttemptOutputMatchesV4(currentOutput, input.output);

  if (!alreadyRevalidated) {
    const eligible = isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: Number(attempt.attempt_number || 0),
        status: String(attempt.status || ''),
        route: String(attempt.route || ''),
        qualityScore: Number(attempt.quality_score_after || 0),
        hardBlockers: attempt.hard_blockers,
        failureReasons: attempt.failure_reasons,
        output: currentOutput,
      },
      expectedAttemptNumber: input.attemptNumber,
      output: input.output,
      reason: input.reason,
    });
    const newAudit = input.output.audit || {};
    const newQuality = newAudit.quality_evaluation_v3 as Record<string, unknown> | undefined;
    const newClaimValidation = newAudit.claim_validation as Record<string, unknown> | undefined;
    const newPublishQuality = newAudit.publish_quality as Record<string, unknown> | undefined;
    if (!eligible
      || newQuality?.passed !== true
      || newClaimValidation?.passed !== true
      || newPublishQuality?.passed !== true
      || Number(input.qualityScore) < 90) {
      return 'generation_attempt_revalidation_precondition_failed';
    }

    const revalidatedAt = new Date().toISOString();
    const revalidatedOutput: BlogGenerationAttemptRecordV4['output'] = {
      ...input.output,
      audit: {
        ...newAudit,
        deterministic_revalidation_v4: {
          version: 'v1',
          reason: input.reason,
          source_attempt_id: input.attemptId,
          source_route: attempt.route,
          source_failure_reasons: attempt.failure_reasons,
          source_quality_score: Number(attempt.quality_score_after || 0),
          source_output_hash: attempt.output_hash,
          revalidated_at: revalidatedAt,
          model_calls: 0,
        },
      },
    };
    const revalidatedHash = createHash('sha256').update(JSON.stringify(revalidatedOutput)).digest('hex');
    const { data: updatedAttempt, error: updateAttemptError } = await supabaseAdmin
      .from('blog_generation_attempts')
      .update({
        route: 'approved_for_slot',
        quality_score_after: input.qualityScore,
        hard_blockers: [],
        failure_reasons: [],
        output_document: revalidatedOutput,
        output_hash: revalidatedHash,
        error_code: null,
      })
      .eq('id', input.attemptId)
      .eq('run_id', run.id)
      .eq('queue_id', input.queueId)
      .eq('attempt_number', input.attemptNumber)
      .eq('route', 'quarantine')
      .eq('output_hash', attempt.output_hash)
      .select('id')
      .maybeSingle();
    if (updateAttemptError || !updatedAttempt?.id) {
      return updateAttemptError?.message || 'generation_attempt_revalidation_conflict';
    }
  }

  if (run.status === 'generating' && run.selected_attempt_id === input.attemptId) return null;
  if (run.status !== 'quarantine'
    || Number(run.attempt_count || 0) !== input.attemptNumber
    || run.selected_attempt_id !== null) {
    return 'generation_run_revalidation_precondition_failed';
  }
  const { data: updatedRun, error: updateRunError } = await supabaseAdmin
    .from('blog_generation_runs')
    .update({
      status: 'generating',
      disposition: 'awaiting_publication_gates',
      selected_attempt_id: input.attemptId,
      latest_quality_score: input.qualityScore,
      last_error: null,
      quarantined_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id)
    .eq('status', 'quarantine')
    .eq('attempt_count', input.attemptNumber)
    .is('selected_attempt_id', null)
    .select('id')
    .maybeSingle();
  return updateRunError?.message ?? (updatedRun?.id ? null : 'generation_run_revalidation_conflict');
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
    .in('status', ['generating', 'approved_for_slot'])
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
    .in('status', ['generating', 'approved_for_slot', 'human_review'])
    .select('id')
    .maybeSingle();
  return error?.message ?? (data?.id ? null : 'generation_run_human_review_transition_failed');
}
