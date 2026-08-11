import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductRegistrationV5PublicationInput = {
  packageId: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  proofRunId: string;
  expectedPointerVersion: number;
  idempotencyKey: string;
  actorId?: string | null;
  channel?: string;
  locale?: string;
  policyVersion?: string;
  publicationState?: 'approved' | 'published' | 'blocked' | 'quarantined';
};

export type ProductRegistrationV5PublicationResult = {
  package_id: string;
  revision_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  proof_run_id: string;
  pointer_version: number;
  publication_state: string;
  policy_version: string;
};

/**
 * Calls the narrow V5 CAS publication contract. The RPC is service-role only;
 * callers must not pass arbitrary customer-field patches.
 */
export async function publishProductRegistrationV5SnapshotAtomic(input: {
  supabase: SupabaseClient;
  publication: ProductRegistrationV5PublicationInput;
}): Promise<ProductRegistrationV5PublicationResult> {
  const publication = input.publication;
  if (!publication.packageId || !publication.revisionId || !publication.snapshotId || !publication.proofRunId) {
    throw new Error('V5_PUBLICATION_LINEAGE_REQUIRED');
  }
  if (!/^[0-9a-f]{64}$/.test(publication.snapshotHash)) {
    throw new Error('V5_PUBLICATION_SNAPSHOT_HASH_INVALID');
  }
  if (!publication.idempotencyKey.trim()) throw new Error('V5_PUBLICATION_IDEMPOTENCY_KEY_REQUIRED');
  if (!Number.isInteger(publication.expectedPointerVersion) || publication.expectedPointerVersion < 0) {
    throw new Error('V5_PUBLICATION_POINTER_VERSION_INVALID');
  }

  const { data, error } = await input.supabase.rpc('publish_product_registration_v5_snapshot_atomic', {
    p_package_id: publication.packageId,
    p_revision_id: publication.revisionId,
    p_snapshot_id: publication.snapshotId,
    p_snapshot_hash: publication.snapshotHash,
    p_proof_run_id: publication.proofRunId,
    p_expected_pointer_version: publication.expectedPointerVersion,
    p_idempotency_key: publication.idempotencyKey,
    p_actor_id: publication.actorId ?? null,
    p_channel: publication.channel ?? 'customer',
    p_locale: publication.locale ?? 'ko-KR',
    p_policy_version: publication.policyVersion ?? 'v5-risk-policy-1',
    p_publication_state: publication.publicationState ?? 'published',
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('V5_PUBLICATION_RESPONSE_INVALID');
  return data as ProductRegistrationV5PublicationResult;
}
