import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import type { BlogAiUsageReceipt } from './blog-ai-caller';
import type { BlogDeepSeekStage, BlogQualityRouteV4 } from './blog-deepseek-orchestrator-v4';

export interface BlogGenerationAttemptRecordV4 {
  queueId: string;
  tenantId?: string | null;
  attemptNumber: number;
  stage: BlogDeepSeekStage;
  route: BlogQualityRouteV4;
  output: { title: string; description: string; slug: string; markdown: string };
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
  const attemptPayload = {
    run_id: run.id,
    queue_id: input.queueId,
    attempt_number: input.attemptNumber,
    stage: input.stage,
    provider: input.receipt.provider,
    model: input.receipt.model,
    thinking_mode: input.stage === 'draft_flash' ? 'disabled' : 'enabled',
    research_fingerprint: input.researchFingerprint ?? null,
    claim_fingerprint: input.claimFingerprint ?? null,
    output_hash: outputHash,
    output_document: input.output,
    input_tokens: cost?.inputTokens ?? null,
    cache_hit_input_tokens: cost?.cacheHitInputTokens ?? null,
    cache_miss_input_tokens: cost?.cacheMissInputTokens ?? null,
    output_tokens: cost?.outputTokens ?? null,
    estimated_cost_usd: cost?.estimatedCostUsd ?? null,
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
  const { error: attemptError } = await supabaseAdmin
    .from('blog_generation_attempts')
    .insert(attemptPayload);
  let attemptPersistenceError = attemptError?.message ?? null;
  if (attemptError?.code === '23505') {
    const { data: existingAttempt, error: existingAttemptError } = await supabaseAdmin
      .from('blog_generation_attempts')
      .select('output_hash')
      .eq('run_id', run.id)
      .eq('attempt_number', input.attemptNumber)
      .maybeSingle();
    attemptPersistenceError = existingAttemptError?.message
      ?? (existingAttempt?.output_hash === outputHash ? null : 'generation_attempt_number_conflict');
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
    .select('id')
    .maybeSingle();
  return error?.message ?? (data?.id ? null : 'approved_generation_run_not_found');
}
