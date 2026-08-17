import type { SupabaseClient } from '@supabase/supabase-js';

export type V5ShadowSnapshotLinkResult =
  | { status: 'linked'; snapshotId: string; revisionId: string }
  | { status: 'skipped'; reason: string }
  | { status: 'unavailable'; reason: string };

/**
 * Links a successfully-created compatibility snapshot to the latest
 * source-backed V5 shadow revision. This is deliberately a best-effort
 * shadow operation: the legacy snapshot transaction remains authoritative
 * until the V5 CAS writer is enabled.
 */
export async function linkV5ShadowRevisionToSnapshot(input: {
  supabase: SupabaseClient;
  packageId: string;
  snapshotHash: string;
  revisionId?: string | null;
  rendererBuildId?: string | null;
}): Promise<V5ShadowSnapshotLinkResult> {
  if (!input.packageId.trim() || !input.snapshotHash.trim()) {
    return { status: 'skipped', reason: 'LINEAGE_INPUT_REQUIRED' };
  }
  return { status: 'skipped', reason: 'V5_SHADOW_LINK_WRITER_RETIRED_USE_SNAPSHOT_CAS' };
}
