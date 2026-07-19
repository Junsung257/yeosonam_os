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
