#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';

type JsonRecord = Record<string, unknown>;

function argument(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim() || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function resolveIncidentCreativeId(): Promise<string> {
  const explicit = argument('--incident-creative-id');
  if (explicit && !isUuid(explicit)) throw new Error('--incident-creative-id must be a UUID');
  if (explicit) return explicit;

  const slug = argument('--incident-slug') || 'guam-daily-food-budget';
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id')
    .eq('channel', 'naver_blog')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data?.id) throw new Error(error?.message || `incident creative not found:${slug}`);
  return String(data.id);
}

async function resolveCanaryRunId(frozenAt: string): Promise<string> {
  const explicit = argument('--canary-run-id');
  if (explicit && !isUuid(explicit)) throw new Error('--canary-run-id must be a UUID');
  if (explicit) return explicit;

  const { data, error } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id')
    .eq('status', 'approved_for_slot')
    .gte('approved_at', frozenAt)
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) throw new Error(error?.message || 'no post-incident approved V5 canary run found');
  return String(data.id);
}

async function main() {
  const apply = hasFlag('--apply');
  const recoveredBy = argument('--recovered-by') || 'codex-blog-recovery';
  const recoveryReason = argument('--reason')
    || 'Public quota counting was corrected and a private V5 editorial canary passed every recovery gate.';

  const { data: state, error: stateError } = await supabaseAdmin
    .from('blog_publication_rollout_state')
    .select('scope,stage,status,state_version,frozen_at,freeze_reason')
    .eq('scope', 'global')
    .single();
  if (stateError || !state) throw new Error(stateError?.message || 'rollout state unavailable');
  if (state.status !== 'frozen' || !state.frozen_at) throw new Error('rollout is not frozen; no recovery write is allowed');

  const incidentCreativeId = await resolveIncidentCreativeId();
  const canaryRunId = await resolveCanaryRunId(String(state.frozen_at));

  const [publicIncident, deletionJobs, runResult] = await Promise.all([
    supabaseAdmin.from('public_blog_content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('id', incidentCreativeId),
    supabaseAdmin.from('blog_indexing_jobs')
      .select('id,status,type,succeeded_at,last_report')
      .eq('content_creative_id', incidentCreativeId)
      .eq('type', 'URL_DELETED')
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin.from('blog_generation_runs')
      .select('id,queue_id,content_creative_id,status,selected_attempt_id,latest_quality_score,approved_at')
      .eq('id', canaryRunId)
      .single(),
  ]);
  if (publicIncident.error) throw new Error(`public incident check failed:${publicIncident.error.message}`);
  if (deletionJobs.error) throw new Error(`deletion evidence check failed:${deletionJobs.error.message}`);
  if (runResult.error || !runResult.data) throw new Error(runResult.error?.message || 'canary run unavailable');

  const run = runResult.data;
  if (!run.selected_attempt_id || !run.content_creative_id) throw new Error('canary run is missing its selected attempt or creative');
  const [attemptResult, creativeResult, evaluationResult] = await Promise.all([
    supabaseAdmin.from('blog_generation_attempts')
      .select('id,run_id,queue_id,status,route,quality_score_after,hard_blockers,failure_reasons,prompt_trace_version,prompt_hash,prompt_template_version,git_commit_sha,brief_hash,claim_packet_hash')
      .eq('id', run.selected_attempt_id)
      .single(),
    supabaseAdmin.from('content_creatives')
      .select('id,slug,status,channel,review_status,quality_gate,generation_meta')
      .eq('id', run.content_creative_id)
      .single(),
    supabaseAdmin.from('blog_quality_evaluations')
      .select('id,evaluator_version,passed,score,failure_reasons,hard_blockers,evaluated_at')
      .eq('queue_id', run.queue_id)
      .eq('evaluator_version', 'blog-editorial-harness-v5.0.0')
      .order('evaluated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (attemptResult.error || !attemptResult.data) throw new Error(attemptResult.error?.message || 'canary attempt unavailable');
  if (creativeResult.error || !creativeResult.data) throw new Error(creativeResult.error?.message || 'canary draft unavailable');
  if (evaluationResult.error || !evaluationResult.data) throw new Error(evaluationResult.error?.message || 'V5 editorial evaluation unavailable');

  const attempt = attemptResult.data;
  const creative = creativeResult.data;
  const evaluation = evaluationResult.data;
  const generationMeta = record(creative.generation_meta);
  const harness = record(generationMeta.editorial_harness_v5);
  const artifact = record(generationMeta.decision_artifact_v1);
  const promptTraceComplete = attempt.prompt_trace_version === 'blog-prompt-trace-v1'
    && [attempt.prompt_hash, attempt.brief_hash, attempt.claim_packet_hash]
      .every((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))
    && typeof attempt.prompt_template_version === 'string' && attempt.prompt_template_version.trim().length > 0
    && typeof attempt.git_commit_sha === 'string' && /^[0-9a-f]{40}$/.test(attempt.git_commit_sha);
  const checks = {
    state_frozen: state.status === 'frozen',
    incident_not_public: Number(publicIncident.count || 0) === 0,
    incident_url_deletion_succeeded: (deletionJobs.data || []).some((job) => job.status === 'succeeded'),
    canary_run_approved: run.status === 'approved_for_slot'
      && Number(run.latest_quality_score || 0) >= 90
      && Date.parse(String(run.approved_at || '')) >= Date.parse(String(state.frozen_at)),
    canary_attempt_approved: attempt.status === 'completed'
      && attempt.route === 'approved_for_slot'
      && Number(attempt.quality_score_after || 0) >= 90
      && Array.isArray(attempt.hard_blockers) && attempt.hard_blockers.length === 0
      && Array.isArray(attempt.failure_reasons) && attempt.failure_reasons.length === 0,
    prompt_trace_complete: promptTraceComplete,
    canary_remains_private: creative.status === 'draft' && creative.channel === 'naver_blog',
    decision_artifact_present: artifact.version === 'blog-decision-artifact-v1',
    editorial_harness_passed: harness.version === 'blog-editorial-harness-v5.0.0' && harness.passed === true,
    independent_editorial_evaluation_passed: evaluation.passed === true
      && Number(evaluation.score || 0) === 100
      && Array.isArray(evaluation.failure_reasons) && evaluation.failure_reasons.length === 0
      && Array.isArray(evaluation.hard_blockers) && evaluation.hard_blockers.length === 0,
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    rollout: state,
    incident_creative_id: incidentCreativeId,
    canary_run_id: canaryRunId,
    canary_creative: { id: creative.id, slug: creative.slug, status: creative.status },
    checks,
    failed_checks: failedChecks,
  }, null, 2));
  if (failedChecks.length > 0) throw new Error(`recovery preflight failed:${failedChecks.join(',')}`);
  if (!apply) return;

  const { data: recovered, error: recoveryError } = await (supabaseAdmin as any)
    .rpc('recover_blog_publication_rollout_v1', {
      p_expected_state_version: state.state_version,
      p_incident_creative_id: incidentCreativeId,
      p_canary_run_id: canaryRunId,
      p_recovery_reason: recoveryReason,
      p_recovered_by: recoveredBy,
    });
  if (recoveryError) throw new Error(`recovery RPC failed:${recoveryError.message}`);

  const { data: audit, error: auditError } = await (supabaseAdmin as any)
    .from('blog_publication_rollout_recoveries')
    .select('id,recovered_at,recovered_by,incident_creative_id,canary_run_id,state_version_before,state_version_after,evidence')
    .eq('canary_run_id', canaryRunId)
    .order('recovered_at', { ascending: false })
    .limit(1)
    .single();
  if (auditError || !audit) throw new Error(auditError?.message || 'recovery audit read-back failed');
  console.log(JSON.stringify({ recovered, audit }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
