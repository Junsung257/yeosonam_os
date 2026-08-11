import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PRODUCT_REGISTRATION_V4_PARSER_ENGINE,
  PRODUCT_REGISTRATION_V4_PARSER_VERSION,
  type ProductRegistrationV4JobRecord,
  type ProductRegistrationV4Stage,
} from './types';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

const JOB_SELECT = [
  'id',
  'tenant_id',
  'source_type',
  'status',
  'source_document_id',
  'extraction_id',
  'v4_stage',
  'v4_attempt_count',
  'v4_lease_expires_at',
  'v4_canonical_normalization_id',
  'v4_parser_engine',
  'v4_parser_version',
  'v4_stage_state',
  'v4_review_reasons',
  'v4_last_error_code',
  'v4_last_error_detail',
  'v6_workflow_run_id',
  'v6_outcome',
  'v6_analysis_outcome',
  'v6_publication_state',
  'v6_publication_blockers',
  'v6_policy_version',
  'v6_last_heartbeat_at',
  'v6_terminal_at',
  'v6_degraded_reasons',
  'v6_blockers',
  'v6_external_cost_krw',
  'v6_fencing_token',
  'created_at',
  'updated_at',
].join(', ');

export async function createProductRegistrationV4Job(input: {
  supabase: SupabaseClient;
  sourceType: 'text' | 'file';
  sourceDocumentId?: string | null;
  normalizedHash?: string | null;
  tenantId?: string | null;
  initialState?: Record<string, unknown>;
}): Promise<ProductRegistrationV4JobRecord> {
  const { data, error } = await input.supabase
    .from('upload_jobs')
    .insert({
      source_type: input.sourceType,
      tenant_id: input.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
      status: 'queued',
      source_document_id: input.sourceDocumentId ?? null,
      normalized_hash: input.normalizedHash ?? null,
      v4_stage: 'uploaded',
      v4_parser_engine: PRODUCT_REGISTRATION_V4_PARSER_ENGINE,
      v4_parser_version: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
      v4_stage_state: input.initialState ?? {},
      v4_review_reasons: [],
    })
    .select(JOB_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as ProductRegistrationV4JobRecord;
}

export async function getProductRegistrationV4Job(input: {
  supabase: SupabaseClient;
  jobId: string;
}): Promise<ProductRegistrationV4JobRecord | null> {
  const { data, error } = await input.supabase
    .from('upload_jobs')
    .select(JOB_SELECT)
    .eq('id', input.jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductRegistrationV4JobRecord | null) ?? null;
}

/** Claims the oldest uploaded job for one worker lease. A conditional update
 * keeps concurrent cron invocations from processing the same job. */
export async function claimNextProductRegistrationV4Job(input: {
  supabase: SupabaseClient;
  leaseSeconds?: number;
}): Promise<ProductRegistrationV4JobRecord | null> {
  // Recover only jobs whose extraction worker lease expired. Later stages are
  // owned by the registration/audit pipeline and must never be rewound here.
  const { error: recoveryError } = await input.supabase
    .from('upload_jobs')
    .update({
      status: 'queued',
      v4_stage: 'uploaded',
      v4_lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .eq('v4_stage', 'preflight')
    .lt('v4_lease_expires_at', new Date().toISOString())
    .not('source_document_id', 'is', null);
  if (recoveryError) throw recoveryError;

  const { data: candidate, error: candidateError } = await input.supabase
    .from('upload_jobs')
    .select(JOB_SELECT)
    .eq('status', 'queued')
    .eq('v4_stage', 'uploaded')
    .not('source_document_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate) {
    // The synchronous compatibility pipeline can advance a job before the
    // asynchronous V4 extractor gets a turn. Backfill the immutable
    // extraction without rewinding the package lifecycle stage.
    const { data: compatibilityCandidate, error: compatibilityCandidateError } = await input.supabase
      .from('upload_jobs')
      .select(JOB_SELECT)
      .eq('status', 'processing')
      .in('v4_stage', ['segmented', 'normalized', 'verified', 'proofed'])
      .is('extraction_id', null)
      .is('v4_lease_expires_at', null)
      .not('source_document_id', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (compatibilityCandidateError) throw compatibilityCandidateError;
    if (!compatibilityCandidate) return null;

    const compatibilityCurrent = compatibilityCandidate as unknown as ProductRegistrationV4JobRecord;
    const compatibilityLeaseExpiresAt = new Date(Date.now() + Math.max(30, Math.min(input.leaseSeconds ?? 300, 900)) * 1000).toISOString();
    const { data: compatibilityClaim, error: compatibilityClaimError } = await input.supabase
      .from('upload_jobs')
      .update({
        v4_attempt_count: Number(compatibilityCurrent.v4_attempt_count ?? 0) + 1,
        v4_lease_expires_at: compatibilityLeaseExpiresAt,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', compatibilityCurrent.id)
      .eq('status', 'processing')
      .in('v4_stage', ['segmented', 'normalized', 'verified', 'proofed'])
      .is('extraction_id', null)
      .is('v4_lease_expires_at', null)
      .select(JOB_SELECT)
      .maybeSingle();
    if (compatibilityClaimError) throw compatibilityClaimError;
    return (compatibilityClaim as ProductRegistrationV4JobRecord | null) ?? null;
  }

  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 300, 900));
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const current = candidate as unknown as ProductRegistrationV4JobRecord;
  const { data, error } = await input.supabase
    .from('upload_jobs')
    .update({
      status: 'processing',
      v4_stage: 'preflight',
      v4_attempt_count: Number(current.v4_attempt_count ?? 0) + 1,
      v4_lease_expires_at: leaseExpiresAt,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .eq('status', 'queued')
    .eq('v4_stage', 'uploaded')
    .not('source_document_id', 'is', null)
    .select(JOB_SELECT)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductRegistrationV4JobRecord | null) ?? null;
}

/** Claims an extracted job for the canonical segmentation/normalization worker. */
export async function claimNextProductRegistrationV4NormalizationJob(input: {
  supabase: SupabaseClient;
  leaseSeconds?: number;
}): Promise<ProductRegistrationV4JobRecord | null> {
  const now = new Date().toISOString();
  const { error: recoveryError } = await input.supabase
    .from('upload_jobs')
    .update({
      status: 'queued',
      v4_stage: 'extracted',
      v4_lease_expires_at: null,
      updated_at: now,
    })
    .eq('status', 'processing')
    .eq('v4_stage', 'segmented')
    .lt('v4_lease_expires_at', now)
    .not('source_document_id', 'is', null)
    .not('extraction_id', 'is', null);
  if (recoveryError) throw recoveryError;

  const { data: candidate, error: candidateError } = await input.supabase
    .from('upload_jobs')
    .select(JOB_SELECT)
    .eq('status', 'queued')
    .eq('v4_stage', 'extracted')
    .not('source_document_id', 'is', null)
    .not('extraction_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (candidate) {
    const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 300, 900));
    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const current = candidate as unknown as ProductRegistrationV4JobRecord;
    const { data, error } = await input.supabase
      .from('upload_jobs')
      .update({
        status: 'processing',
        v4_stage: 'segmented',
        v4_attempt_count: Number(current.v4_attempt_count ?? 0) + 1,
        v4_lease_expires_at: leaseExpiresAt,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .eq('status', 'queued')
      .eq('v4_stage', 'extracted')
      .not('source_document_id', 'is', null)
      .not('extraction_id', 'is', null)
      .select(JOB_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as ProductRegistrationV4JobRecord;
  }

  // Compatibility uploads finish the legacy package writer synchronously and
  // leave the V4 job at `normalized`. Claim that job for the canonical
  // snapshot sidecar without rewinding its customer lifecycle stage.
  const { error: normalizedRecoveryError } = await input.supabase
    .from('upload_jobs')
    .update({ v4_lease_expires_at: null, updated_at: now })
    .eq('status', 'processing')
    .in('v4_stage', ['normalized', 'verified', 'proofed'])
    .is('v4_canonical_normalization_id', null)
    .lt('v4_lease_expires_at', now)
    .not('source_document_id', 'is', null)
    .not('extraction_id', 'is', null);
  if (normalizedRecoveryError) throw normalizedRecoveryError;

  const { data: normalizedCandidate, error: normalizedCandidateError } = await input.supabase
    .from('upload_jobs')
    .select(JOB_SELECT)
    .eq('status', 'processing')
    .in('v4_stage', ['normalized', 'verified', 'proofed'])
    .is('v4_canonical_normalization_id', null)
    .is('v4_lease_expires_at', null)
    .not('source_document_id', 'is', null)
    .not('extraction_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (normalizedCandidateError) throw normalizedCandidateError;
  if (!normalizedCandidate) return null;

  const normalizedCurrent = normalizedCandidate as unknown as ProductRegistrationV4JobRecord;
  const normalizedLeaseExpiresAt = new Date(Date.now() + Math.max(30, Math.min(input.leaseSeconds ?? 300, 900)) * 1000).toISOString();
  const { data: normalizedClaim, error: normalizedClaimError } = await input.supabase
    .from('upload_jobs')
    .update({
      status: 'processing',
      v4_attempt_count: Number(normalizedCurrent.v4_attempt_count ?? 0) + 1,
      v4_lease_expires_at: normalizedLeaseExpiresAt,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', normalizedCurrent.id)
    .eq('status', 'processing')
    .in('v4_stage', ['normalized', 'verified', 'proofed'])
    .is('v4_canonical_normalization_id', null)
    .is('v4_lease_expires_at', null)
    .select(JOB_SELECT)
    .maybeSingle();
  if (normalizedClaimError) throw normalizedClaimError;
  return (normalizedClaim as ProductRegistrationV4JobRecord | null) ?? null;
}

export async function transitionProductRegistrationV4Job(input: {
  supabase: SupabaseClient;
  jobId: string;
  stage: ProductRegistrationV4Stage;
  status?: 'queued' | 'processing' | 'done' | 'failed';
  state?: Record<string, unknown>;
  reviewReasons?: string[];
  errorCode?: string | null;
  errorDetail?: string | null;
  extractionId?: string | null;
  canonicalNormalizationId?: string | null;
  clearLease?: boolean;
}): Promise<ProductRegistrationV4JobRecord> {
  const current = await getProductRegistrationV4Job({ supabase: input.supabase, jobId: input.jobId });
  if (!current) throw new Error('JOB_NOT_FOUND');
  const patch: Record<string, unknown> = {
    v4_stage: input.stage,
    v4_stage_state: input.state === undefined
      ? (current.v4_stage_state ?? {})
      : { ...(current.v4_stage_state ?? {}), ...input.state },
    v4_review_reasons: input.reviewReasons ?? [],
    v4_last_error_code: input.errorCode ?? null,
    v4_last_error_detail: input.errorDetail ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.status) patch.status = input.status;
  if (input.extractionId !== undefined) patch.extraction_id = input.extractionId;
  if (input.canonicalNormalizationId !== undefined) {
    patch.v4_canonical_normalization_id = input.canonicalNormalizationId;
  }
  if (input.status === 'processing') patch.started_at = new Date().toISOString();
  if (input.status === 'done') patch.completed_at = new Date().toISOString();
  if (input.clearLease
    || input.status === 'done' || input.status === 'failed'
    || input.stage === 'needs_review' || input.stage === 'failed' || input.stage === 'quarantined') {
    patch.v4_lease_expires_at = null;
  }

  const { data, error } = await input.supabase
    .from('upload_jobs')
    .update(patch)
    .eq('id', input.jobId)
    .select(JOB_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as ProductRegistrationV4JobRecord;
}
