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
  void input;
  throw new Error('V5_PUBLICATION_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
}
