import { BLOG_AUTOPILOT_PIPELINE_VERSION, BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION, isBlogQualityDecisionPublishableV4, readBlogDeploymentCommitShaV4, type BlogQualityDecisionV4 } from '@/lib/blog-autopilot-v4-contract';
import { readBlogBrowserPreviewEvidenceV4 } from '@/lib/blog-browser-preview-v4';
import { readBlogInformationResearchBundle } from '@/lib/blog-generation-research';
import { supabaseAdmin } from '@/lib/supabase';

export const BLOG_AUTOPILOT_STAGE_SERVICE_VERSION_V4 = 'blog-autopilot-stage-services-v4.0.0' as const;

export async function readBlogPipelineCandidateV4(queueId: string) {
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,status,updated_at,target_publish_at,topic,destination,primary_keyword,meta')
    .eq('id', queueId)
    .maybeSingle();
  if (error) throw new Error(`blog_queue_read_failed:${error.message}`);
  if (!data) throw new Error('blog_queue_missing');
  return {
    ...data,
    eligible: ['queued', 'pending_review', 'generating'].includes(String(data.status)),
    researchPersisted: Boolean(readBlogInformationResearchBundle(data.meta)),
  };
}

export async function readBlogGenerationArtifactsV4(queueId: string) {
  const { data: run, error } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id,status,content_creative_id,selected_attempt_id,latest_quality_score,disposition,last_error,scheduled_publish_at,pipeline_version,deployment_commit_sha,schema_migration_version')
    .eq('queue_id', queueId)
    .eq('generation_key', `queue:${queueId}`)
    .maybeSingle();
  if (error) throw new Error(`blog_generation_run_read_failed:${error.message}`);
  if (!run) throw new Error('blog_generation_run_missing_after_generation');

  const { data: queue, error: queueError } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id,status,meta,content_creative_id,last_error')
    .eq('id', queueId)
    .maybeSingle();
  if (queueError) throw new Error(`blog_queue_artifact_read_failed:${queueError.message}`);
  const researchPersisted = Boolean(readBlogInformationResearchBundle(queue?.meta));

  const { data: attempt, error: attemptError } = run.selected_attempt_id
    ? await supabaseAdmin
      .from('blog_generation_attempts')
      .select('id,attempt_number,route,hard_blockers,failure_reasons,claim_fingerprint,claim_packet_hash,prompt_hash,prompt_template_version,prompt_trace_version')
      .eq('id', run.selected_attempt_id)
      .maybeSingle()
    : { data: null, error: null };
  if (attemptError) throw new Error(`blog_generation_attempt_read_failed:${attemptError.message}`);

  return { run, queue, attempt, researchPersisted };
}

export async function readBlogQualityAndPreviewGatesV4(creativeId: string | null | undefined) {
  if (!creativeId) return { passed: false as const, reason: 'blog_pipeline_creative_missing', qualityDecision: null, preview: null };
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id,status,generation_meta')
    .eq('id', creativeId)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) throw new Error(`blog_pipeline_creative_read_failed:${error.message}`);
  const meta = data?.generation_meta && typeof data.generation_meta === 'object'
    ? data.generation_meta as Record<string, unknown>
    : {};
  const qualityDecision = meta.quality_decision_v4 && typeof meta.quality_decision_v4 === 'object'
    ? meta.quality_decision_v4 as BlogQualityDecisionV4
    : null;
  const preview = readBlogBrowserPreviewEvidenceV4(meta);
  if (!qualityDecision || !isBlogQualityDecisionPublishableV4(qualityDecision)) {
    return { passed: false as const, reason: 'blog_quality_decision_v4_not_passed', qualityDecision, preview };
  }
  if (!preview || !preview.passed || preview.score < 95) {
    return { passed: false as const, reason: 'blog_browser_preview_gate_not_passed', qualityDecision, preview };
  }
  return { passed: true as const, reason: null, qualityDecision, preview };
}

export function buildBlogPipelineObservationV4(input: {
  queueId: string;
  contentVersion: string;
  runId?: string | null;
}) {
  return {
    serviceVersion: BLOG_AUTOPILOT_STAGE_SERVICE_VERSION_V4,
    pipelineVersion: BLOG_AUTOPILOT_PIPELINE_VERSION,
    schemaMigrationVersion: BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
    deploymentCommitSha: readBlogDeploymentCommitShaV4(),
    queueId: input.queueId,
    contentVersion: input.contentVersion,
    runId: input.runId ?? null,
    observedAt: new Date().toISOString(),
  };
}
