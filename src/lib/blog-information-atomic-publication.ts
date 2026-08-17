import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import {
  buildBlogInformationRepresentativeKey,
  type BlogInformationRepresentativeIdentity,
} from './blog-information-representative';

export interface BlogInformationAtomicPublicationInput {
  creativeId: string;
  reviewCaseId?: string | null;
  actorId?: string | null;
  contentFingerprint: string;
  validationMeta: Record<string, unknown>;
  qualityGate: object;
  publishedAt: string;
  identity: BlogInformationRepresentativeIdentity;
  reservationOwner: string;
  idempotencyKey?: string;
}

export interface BlogInformationAtomicPublicationResult {
  creativeId: string;
  slug: string;
  publishedAt: string;
  representativeKey: string;
  indexingJobId: string;
  idempotent: boolean;
}

interface AtomicPublicationRpcRow {
  creative_id: string;
  slug: string;
  published_at: string;
  representative_key: string;
  indexing_job_id: string;
  idempotent: boolean;
}

interface AtomicReplacementRpcRow {
  target_creative_id: string;
  replacement_draft_id: string;
  slug: string;
  published_at: string;
  representative_key: string;
  replacement_id: string;
  indexing_job_id: string;
  idempotent: boolean;
}

export interface BlogInformationAutomatedReplacementInput {
  replacementDraftId: string;
  targetCreativeId: string;
  runId: string;
  selectedAttemptId: string;
  sourceFingerprint: string;
  validationMeta: Record<string, unknown>;
  qualityGate: object;
  identity: BlogInformationRepresentativeIdentity;
  idempotencyKey?: string;
}

export interface BlogInformationAtomicReplacementInput {
  replacementDraftId: string;
  targetCreativeId: string;
  reviewCaseId: string;
  actorId: string;
  sourceFingerprint: string;
  validationMeta: Record<string, unknown>;
  qualityGate: object;
  identity: BlogInformationRepresentativeIdentity;
  idempotencyKey?: string;
}

export interface BlogInformationAtomicReplacementResult {
  targetCreativeId: string;
  replacementDraftId: string;
  slug: string;
  publishedAt: string;
  representativeKey: string;
  replacementId: string;
  indexingJobId: string;
  idempotent: boolean;
}

export function buildBlogInformationPublicationIdempotencyKey(input: {
  creativeId: string;
  contentFingerprint: string;
  representativeKey: string;
}): string {
  const digest = createHash('sha256')
    .update(`${input.creativeId}|${input.contentFingerprint}|${input.representativeKey}`, 'utf8')
    .digest('hex');
  return `info-publish-v1:${digest}`;
}

export async function publishBlogInformationAtomically(
  input: BlogInformationAtomicPublicationInput,
): Promise<BlogInformationAtomicPublicationResult> {
  const representativeKey = buildBlogInformationRepresentativeKey(input.identity);
  const idempotencyKey = input.idempotencyKey ?? buildBlogInformationPublicationIdempotencyKey({
    creativeId: input.creativeId,
    contentFingerprint: input.contentFingerprint,
    representativeKey,
  });
  const { data, error } = await supabaseAdmin.rpc('publish_blog_information_atomically', {
    p_creative_id: input.creativeId,
    p_case_id: input.reviewCaseId ?? null,
    p_actor_id: input.actorId ?? null,
    p_content_fingerprint: input.contentFingerprint,
    p_validation_meta: input.validationMeta,
    p_quality_gate: input.qualityGate,
    p_published_at: input.publishedAt,
    p_representative_key: representativeKey,
    p_destination_id: input.identity.destinationId,
    p_intent: input.identity.intent,
    p_audience: input.identity.audience,
    p_locale: input.identity.locale,
    p_reservation_owner: input.reservationOwner,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    throw new Error(`blog_information_atomic_publish_failed:${error.message}`);
  }
  const row = (data as AtomicPublicationRpcRow[] | null)?.[0];
  if (!row) throw new Error('blog_information_atomic_publish_missing_result');
  return {
    creativeId: row.creative_id,
    slug: row.slug,
    publishedAt: row.published_at,
    representativeKey: row.representative_key,
    indexingJobId: row.indexing_job_id,
    idempotent: row.idempotent,
  };
}

export function buildBlogInformationReplacementIdempotencyKey(input: {
  replacementDraftId: string;
  targetCreativeId: string;
  sourceFingerprint: string;
  representativeKey: string;
}): string {
  const digest = createHash('sha256')
    .update([
      input.replacementDraftId,
      input.targetCreativeId,
      input.sourceFingerprint,
      input.representativeKey,
    ].join('|'), 'utf8')
    .digest('hex');
  return `info-replace-v1:${digest}`;
}

export function buildBlogInformationAutomatedReplacementIdempotencyKey(input: {
  replacementDraftId: string;
  targetCreativeId: string;
  runId: string;
  selectedAttemptId: string;
  sourceFingerprint: string;
  representativeKey: string;
}): string {
  const digest = createHash('sha256')
    .update([
      input.replacementDraftId,
      input.targetCreativeId,
      input.runId,
      input.selectedAttemptId,
      input.sourceFingerprint,
      input.representativeKey,
    ].join('|'), 'utf8')
    .digest('hex');
  return `info-auto-replace-v1:${digest}`;
}

export async function replaceBlogInformationAutomatedDraftAtomically(
  input: BlogInformationAutomatedReplacementInput,
): Promise<BlogInformationAtomicReplacementResult> {
  const representativeKey = buildBlogInformationRepresentativeKey(input.identity);
  const idempotencyKey = input.idempotencyKey
    ?? buildBlogInformationAutomatedReplacementIdempotencyKey({
      replacementDraftId: input.replacementDraftId,
      targetCreativeId: input.targetCreativeId,
      runId: input.runId,
      selectedAttemptId: input.selectedAttemptId,
      sourceFingerprint: input.sourceFingerprint,
      representativeKey,
    });
  const { data, error } = await supabaseAdmin.rpc(
    'replace_blog_information_automated_draft_atomically',
    {
      p_replacement_draft_id: input.replacementDraftId,
      p_target_creative_id: input.targetCreativeId,
      p_run_id: input.runId,
      p_selected_attempt_id: input.selectedAttemptId,
      p_source_fingerprint: input.sourceFingerprint,
      p_validation_meta: input.validationMeta,
      p_quality_gate: input.qualityGate,
      p_representative_key: representativeKey,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) {
    throw new Error(`blog_information_atomic_auto_replace_failed:${error.message}`);
  }
  const row = (data as AtomicReplacementRpcRow[] | null)?.[0];
  if (!row) throw new Error('blog_information_atomic_auto_replace_missing_result');
  return {
    targetCreativeId: row.target_creative_id,
    replacementDraftId: row.replacement_draft_id,
    slug: row.slug,
    publishedAt: row.published_at,
    representativeKey: row.representative_key,
    replacementId: row.replacement_id,
    indexingJobId: row.indexing_job_id,
    idempotent: row.idempotent,
  };
}

export async function replaceBlogInformationReviewedDraftAtomically(
  input: BlogInformationAtomicReplacementInput,
): Promise<BlogInformationAtomicReplacementResult> {
  const representativeKey = buildBlogInformationRepresentativeKey(input.identity);
  const idempotencyKey = input.idempotencyKey ?? buildBlogInformationReplacementIdempotencyKey({
    replacementDraftId: input.replacementDraftId,
    targetCreativeId: input.targetCreativeId,
    sourceFingerprint: input.sourceFingerprint,
    representativeKey,
  });
  const { data, error } = await supabaseAdmin.rpc(
    'replace_blog_information_reviewed_draft_atomically',
    {
      p_replacement_draft_id: input.replacementDraftId,
      p_target_creative_id: input.targetCreativeId,
      p_case_id: input.reviewCaseId,
      p_actor_id: input.actorId,
      p_source_fingerprint: input.sourceFingerprint,
      p_validation_meta: input.validationMeta,
      p_quality_gate: input.qualityGate,
      p_representative_key: representativeKey,
      p_idempotency_key: idempotencyKey,
    },
  );
  if (error) {
    throw new Error(`blog_information_atomic_replace_failed:${error.message}`);
  }
  const row = (data as AtomicReplacementRpcRow[] | null)?.[0];
  if (!row) throw new Error('blog_information_atomic_replace_missing_result');
  return {
    targetCreativeId: row.target_creative_id,
    replacementDraftId: row.replacement_draft_id,
    slug: row.slug,
    publishedAt: row.published_at,
    representativeKey: row.representative_key,
    replacementId: row.replacement_id,
    indexingJobId: row.indexing_job_id,
    idempotent: row.idempotent,
  };
}
