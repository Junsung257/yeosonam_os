import type { BlogPackageSnapshotPinV4 } from './types';

export interface BlogPackageSnapshotPointerV4 {
  package_id: string;
  current_snapshot_id: string | null;
  current_revision_id?: string | null;
  state: string;
}

export interface BlogPublicPackageSnapshotV4 {
  id: string;
  package_id: string;
  package_revision: number;
  snapshot_hash: string;
  status: string;
}

export function validateBlogPackageSnapshotPinV4(input: {
  pin: BlogPackageSnapshotPinV4;
  pointer: BlogPackageSnapshotPointerV4 | null;
  snapshot: BlogPublicPackageSnapshotV4 | null;
}): { valid: boolean; reason: string | null } {
  if (!input.pointer || !input.snapshot) return { valid: false, reason: 'package_snapshot_lineage_missing' };
  if (!['approved', 'published'].includes(input.pointer.state)) {
    return { valid: false, reason: 'package_publication_pointer_not_active' };
  }
  if (!['approved', 'published'].includes(input.snapshot.status)) {
    return { valid: false, reason: 'package_snapshot_not_public_eligible' };
  }
  if (input.pointer.package_id !== input.pin.packageId
    || input.snapshot.package_id !== input.pin.packageId) {
    return { valid: false, reason: 'package_snapshot_package_mismatch' };
  }
  if (input.pointer.current_snapshot_id !== input.pin.snapshotId
    || input.snapshot.id !== input.pin.snapshotId) {
    return { valid: false, reason: 'package_snapshot_pointer_stale' };
  }
  if (Number(input.snapshot.package_revision) !== input.pin.revision) {
    return { valid: false, reason: 'package_snapshot_revision_mismatch' };
  }
  if (input.snapshot.snapshot_hash !== input.pin.hash) {
    return { valid: false, reason: 'package_snapshot_hash_mismatch' };
  }
  return { valid: true, reason: null };
}
