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

  let revisionId = input.revisionId?.trim() || null;
  if (!revisionId) {
    const { data: packageRow, error: packageError } = await input.supabase
      .from('travel_packages')
      .select('canonical_revision_id')
      .eq('id', input.packageId)
      .maybeSingle();
    if (packageError) return { status: 'unavailable', reason: packageError.message };
    revisionId = typeof packageRow?.canonical_revision_id === 'string'
      ? packageRow.canonical_revision_id
      : null;
  }
  if (!revisionId) return { status: 'skipped', reason: 'V5_CANONICAL_REVISION_POINTER_MISSING' };

  const { data: revision, error: revisionError } = await input.supabase
    .from('product_registration_v5_revisions')
    .select('id,status,package_id')
    .eq('id', revisionId)
    .eq('package_id', input.packageId)
    .in('status', ['candidate', 'verified', 'approved', 'published'])
    .limit(1)
    .maybeSingle();

  if (revisionError) return { status: 'unavailable', reason: revisionError.message };
  if (!revision?.id) return { status: 'skipped', reason: 'V5_REVISION_NOT_READY' };

  const { data: snapshot, error: snapshotError } = await input.supabase
    .from('public_package_snapshots')
    .select('id,canonical_revision_id')
    .eq('package_id', input.packageId)
    .eq('snapshot_hash', input.snapshotHash)
    .in('status', ['published', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError) return { status: 'unavailable', reason: snapshotError.message };
  if (!snapshot?.id) return { status: 'skipped', reason: 'PUBLIC_SNAPSHOT_NOT_FOUND' };
  if (snapshot.canonical_revision_id && snapshot.canonical_revision_id !== revision.id) {
    return { status: 'skipped', reason: 'PUBLIC_SNAPSHOT_ALREADY_BOUND_TO_OTHER_REVISION' };
  }

  const patch: Record<string, unknown> = { canonical_revision_id: revision.id };
  if (input.rendererBuildId?.trim()) patch.renderer_build_id = input.rendererBuildId.trim();

  const { error: updateError } = await input.supabase
    .from('public_package_snapshots')
    .update(patch)
    .eq('id', snapshot.id)
    .eq('package_id', input.packageId)
    .eq('snapshot_hash', input.snapshotHash);

  if (updateError) return { status: 'unavailable', reason: updateError.message };
  return { status: 'linked', snapshotId: String(snapshot.id), revisionId: String(revision.id) };
}
