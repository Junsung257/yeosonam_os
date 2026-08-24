import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  BlogContentOperationStage,
  BlogContentOperationStatus,
  BlogDemandMaterializationDecisionV4,
} from './types';

function oneRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function persistBlogDemandMaterializationV4(input: {
  supabase: SupabaseClient;
  decision: BlogDemandMaterializationDecisionV4;
}): Promise<{ clusterId: string; operationId: string; operationCreated: boolean }> {
  const { decision } = input;
  const { data, error } = await input.supabase.rpc('materialize_blog_content_operation_v4', {
    p_cluster: {
      cluster_key: decision.clusterKey,
      normalized_query: decision.normalizedQuery,
      primary_query: decision.primaryQuery,
      intent: decision.intent,
      destination_id: decision.destinationId,
      audience: decision.audience,
      locale: decision.locale,
      demand_score: decision.demandScore,
      risk_level: decision.riskLevel,
      freshness_expires_at: decision.freshnessExpiresAt,
      representative_key: decision.representativeKey,
      canonical_creative_id: decision.canonicalCreativeId,
      decision: decision.decision,
      decision_reason: decision.decisionReason,
      metadata: {
        materializer_version: 'blog-demand-materializer-v4',
        demand_score_components: decision.scoreComponents,
      },
    },
    p_signal: {
      provider: decision.signal.provider,
      signal_key: decision.signal.signalKey,
      source_reference: decision.signal.sourceReference,
      source_row_hash: decision.signal.sourceRowHash,
      metric_value: decision.signal.metricValue ?? null,
      metrics: decision.signal.metrics ?? {},
      observed_at: decision.signal.observedAt,
      expires_at: decision.signal.expiresAt ?? null,
      verified_at: decision.signal.verifiedAt,
      verifier_type: decision.signal.verifierType ?? 'system',
    },
    p_operation: {
      operation_type: decision.operationType,
      operation_day_kst: decision.operationDayKst,
      creates_new_url: decision.createsNewUrl,
      risk_level: decision.riskLevel,
      idempotency_key: decision.idempotencyKey,
      queue_id: decision.queueId,
      creative_id: decision.creativeId,
      representative_key: decision.representativeKey,
      target_creative_id: decision.refreshTargetCreativeId,
      package_id: decision.packageSnapshot?.packageId ?? null,
      package_snapshot_id: decision.packageSnapshot?.snapshotId ?? null,
      package_snapshot_revision: decision.packageSnapshot?.revision ?? null,
      package_snapshot_hash: decision.packageSnapshot?.hash ?? null,
      input_snapshot: {
        query: decision.primaryQuery,
        cluster_key: decision.clusterKey,
        signal_hash: decision.signal.sourceRowHash,
        demand_score_components: decision.scoreComponents,
      },
    },
  });
  if (error) throw new Error(`blog_content_materialization_failed:${error.message}`);
  const row = oneRow(data as { cluster_id: string; operation_id: string; operation_created: boolean } | Array<{ cluster_id: string; operation_id: string; operation_created: boolean }> | null);
  if (!row?.cluster_id || !row.operation_id) throw new Error('blog_content_materialization_result_missing');
  return { clusterId: row.cluster_id, operationId: row.operation_id, operationCreated: row.operation_created };
}

export async function requeueBlogContentOperationV4(input: {
  supabase: SupabaseClient;
  operationId: string;
}): Promise<void> {
  const { error } = await input.supabase.rpc('requeue_blog_content_operation_v4', {
    p_operation_id: input.operationId,
  });
  if (error) throw new Error(`blog_content_operation_requeue_failed:${error.message}`);
}

const BLOG_CONTENT_OPERATION_TERMINAL_STATUSES = [
  'failed',
  'human_review',
  'approved_for_slot',
  'research_backlog',
  'quarantined',
  'cancelled',
] as const;

type BlogContentOperationTerminalStatus = (typeof BLOG_CONTENT_OPERATION_TERMINAL_STATUSES)[number];

export async function terminalizeBlogContentOperationV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  fencingToken: number;
  leaseOwner: string;
  status: BlogContentOperationTerminalStatus;
  stage: BlogContentOperationStage;
  eventKey: string;
  failureCode?: string | null;
  skipReason?: string | null;
  generationRunId?: string | null;
  creativeId?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<string> {
  if (!BLOG_CONTENT_OPERATION_TERMINAL_STATUSES.includes(input.status)) {
    throw new Error(`blog_content_operation_terminal_status_invalid:${input.status}`);
  }
  const { data, error } = await input.supabase.rpc('terminalize_blog_content_operation_v4', {
    p_operation_id: input.operationId,
    p_fencing_token: input.fencingToken,
    p_lease_owner: input.leaseOwner,
    p_terminal_status: input.status,
    p_stage: input.stage,
    p_event_key: input.eventKey,
    p_failure_code: input.failureCode ?? null,
    p_skip_reason: input.skipReason ?? null,
    p_generation_run_id: input.generationRunId ?? null,
    p_creative_id: input.creativeId ?? null,
    p_evidence: input.evidence ?? {},
  });
  if (error) throw new Error(`blog_content_operation_terminalize_failed:${error.message}`);
  if (typeof data !== 'string') throw new Error('blog_content_operation_terminal_event_id_missing');
  return data;
}

export async function claimBlogContentOperationV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  leaseOwner: string;
  leaseSeconds?: number;
}): Promise<{ id: string; queueId: string; fencingToken: number }> {
  const { data, error } = await input.supabase.rpc('claim_blog_content_operation_v4', {
    p_operation_id: input.operationId,
    p_lease_owner: input.leaseOwner,
    p_lease_seconds: input.leaseSeconds ?? 300,
  });
  if (error) throw new Error(`blog_content_operation_claim_failed:${error.message}`);
  const row = oneRow(data as { id: string; queue_id: string | null; fencing_token: number } | Array<{ id: string; queue_id: string | null; fencing_token: number }> | null);
  if (!row?.id || !row.queue_id || !Number.isInteger(Number(row.fencing_token))) {
    throw new Error('blog_content_operation_claim_result_invalid');
  }
  return { id: row.id, queueId: row.queue_id, fencingToken: Number(row.fencing_token) };
}

export async function bindBlogContentOperationWorkflowV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  fencingToken: number;
  leaseOwner: string;
  workflowRunId: string;
}): Promise<void> {
  const { error } = await input.supabase.rpc('bind_blog_content_operation_workflow_v4', {
    p_operation_id: input.operationId,
    p_fencing_token: input.fencingToken,
    p_lease_owner: input.leaseOwner,
    p_workflow_run_id: input.workflowRunId,
  });
  if (error) throw new Error(`blog_content_operation_bind_failed:${error.message}`);
}

export async function claimBlogContentOperationPublicationV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  leaseOwner: string;
  operationDayKst: string;
  maxOperations: number;
  maxNewUrls: number;
  leaseSeconds?: number;
}): Promise<{ id: string; fencingToken: number; createsNewUrl: boolean }> {
  const { data, error } = await input.supabase.rpc('claim_blog_content_operation_publication_v4', {
    p_operation_id: input.operationId,
    p_lease_owner: input.leaseOwner,
    p_operation_day_kst: input.operationDayKst,
    p_max_operations: input.maxOperations,
    p_max_new_urls: input.maxNewUrls,
    p_lease_seconds: input.leaseSeconds ?? 180,
  });
  if (error) throw new Error(`blog_content_operation_publication_claim_failed:${error.message}`);
  const row = oneRow(data as { id: string; fencing_token: number; creates_new_url: boolean } | Array<{ id: string; fencing_token: number; creates_new_url: boolean }> | null);
  if (!row?.id || !Number.isInteger(Number(row.fencing_token))) {
    throw new Error('blog_content_operation_publication_claim_result_invalid');
  }
  return { id: row.id, fencingToken: Number(row.fencing_token), createsNewUrl: row.creates_new_url };
}

export async function recordBlogContentOperationStageV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  fencingToken: number;
  leaseOwner: string;
  eventKey: string;
  stage: BlogContentOperationStage;
  eventStatus: 'started' | 'succeeded' | 'retryable_failure' | 'failed' | 'skipped';
  operationStatus?: BlogContentOperationStatus;
  failureCode?: string | null;
  generationRunId?: string | null;
  creativeId?: string | null;
  evidence?: Record<string, unknown>;
  receipt?: {
    provider?: 'deepseek';
    model?: string;
    attemptNumber?: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    durationMs?: number;
  };
}): Promise<string> {
  const { data, error } = await input.supabase.rpc('record_blog_content_stage_event_v4', {
    p_operation_id: input.operationId,
    p_fencing_token: input.fencingToken,
    p_lease_owner: input.leaseOwner,
    p_event: {
      event_key: input.eventKey,
      stage: input.stage,
      status: input.eventStatus,
      operation_status: input.operationStatus ?? null,
      failure_code: input.failureCode ?? null,
      generation_run_id: input.generationRunId ?? null,
      creative_id: input.creativeId ?? null,
      evidence: input.evidence ?? {},
      provider: input.receipt?.provider ?? null,
      model: input.receipt?.model ?? null,
      attempt_number: input.receipt?.attemptNumber ?? null,
      input_tokens: input.receipt?.inputTokens ?? null,
      cached_input_tokens: input.receipt?.cachedInputTokens ?? null,
      output_tokens: input.receipt?.outputTokens ?? null,
      estimated_cost_usd: input.receipt?.estimatedCostUsd ?? null,
      duration_ms: input.receipt?.durationMs ?? null,
    },
  });
  if (error) throw new Error(`blog_content_stage_record_failed:${error.message}`);
  if (typeof data !== 'string') throw new Error('blog_content_stage_event_id_missing');
  return data;
}

export async function publishBlogCommercialOperationV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  fencingToken: number;
  leaseOwner: string;
  generationRunId: string;
  selectedAttemptId: string;
  creativeId: string;
  publicationMode: 'reviewed_only' | 'live';
  publishedAt: string;
}): Promise<{
  creativeId: string;
  slug: string;
  publishedAt: string;
  indexingJobId: string;
  idempotent: boolean;
}> {
  const { data, error } = await input.supabase.rpc('publish_blog_commercial_operation_v4', {
    p_operation_id: input.operationId,
    p_fencing_token: input.fencingToken,
    p_lease_owner: input.leaseOwner,
    p_generation_run_id: input.generationRunId,
    p_selected_attempt_id: input.selectedAttemptId,
    p_creative_id: input.creativeId,
    p_publication_mode: input.publicationMode,
    p_published_at: input.publishedAt,
  });
  if (error) throw new Error(`blog_commercial_atomic_publish_failed:${error.message}`);
  const row = oneRow(data as {
    creative_id: string;
    slug: string;
    published_at: string;
    indexing_job_id: string;
    idempotent: boolean;
  } | Array<{
    creative_id: string;
    slug: string;
    published_at: string;
    indexing_job_id: string;
    idempotent: boolean;
  }> | null);
  if (!row?.creative_id || !row.slug || !row.indexing_job_id) {
    throw new Error('blog_commercial_atomic_publish_result_invalid');
  }
  return {
    creativeId: row.creative_id,
    slug: row.slug,
    publishedAt: row.published_at,
    indexingJobId: row.indexing_job_id,
    idempotent: row.idempotent,
  };
}
