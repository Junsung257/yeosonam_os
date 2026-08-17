import type { SupabaseClient } from '@supabase/supabase-js';

import type { UploadPersistenceRows } from './persistence-rows';

export type UploadPersistenceResult = {
  productInserted: boolean;
  productUpdated: boolean;
  packageRow: Record<string, unknown> | null;
  packageId: string | null;
  priceRowsSaved: number;
};

/**
 * Retired V3 compatibility writer.
 *
 * A source upload must enter the durable Registration Kernel workflow and
 * commit one immutable revision aggregate. Keeping this signature makes old
 * callers fail closed while they are removed without allowing products or
 * travel_packages to be mutated first.
 */
export async function persistUploadRegistrationRows(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  internalCode: string | null;
  rows: UploadPersistenceRows;
}): Promise<UploadPersistenceResult> {
  void input;
  throw new Error('LEGACY_UPLOAD_PERSISTENCE_RETIRED_USE_REGISTRATION_KERNEL_WORKFLOW');
}

/** Immutable revisions are corrected with another revision, never rollback-delete. */
export async function rollbackInsertedUploadProduct(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  internalCode: string | null;
  productInserted: boolean;
}): Promise<{ rolledBack: boolean; error?: string }> {
  void input;
  return {
    rolledBack: false,
    error: 'LEGACY_UPLOAD_ROLLBACK_RETIRED_IMMUTABLE_REVISION_REQUIRES_NEW_CORRECTION',
  };
}
