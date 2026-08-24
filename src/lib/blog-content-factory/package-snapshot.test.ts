import { describe, expect, it } from 'vitest';

import { validateBlogPackageSnapshotPinV4 } from './package-snapshot';

const pin = {
  packageId: '11111111-1111-4111-8111-111111111111',
  snapshotId: '22222222-2222-4222-8222-222222222222',
  revision: 4,
  hash: 'hash-4',
};

describe('Blog V4 immutable package snapshot', () => {
  it('accepts the exact current approved pointer, revision and hash', () => {
    expect(validateBlogPackageSnapshotPinV4({
      pin,
      pointer: { package_id: pin.packageId, current_snapshot_id: pin.snapshotId, state: 'published' },
      snapshot: { id: pin.snapshotId, package_id: pin.packageId, package_revision: 4, snapshot_hash: 'hash-4', status: 'published' },
    })).toEqual({ valid: true, reason: null });
  });

  it('fails closed after the package pointer moves to a newer snapshot', () => {
    expect(validateBlogPackageSnapshotPinV4({
      pin,
      pointer: { package_id: pin.packageId, current_snapshot_id: '33333333-3333-4333-8333-333333333333', state: 'published' },
      snapshot: { id: pin.snapshotId, package_id: pin.packageId, package_revision: 4, snapshot_hash: 'hash-4', status: 'published' },
    })).toEqual({ valid: false, reason: 'package_snapshot_pointer_stale' });
  });

  it('rejects mutable or blocked snapshot states', () => {
    expect(validateBlogPackageSnapshotPinV4({
      pin,
      pointer: { package_id: pin.packageId, current_snapshot_id: pin.snapshotId, state: 'blocked' },
      snapshot: { id: pin.snapshotId, package_id: pin.packageId, package_revision: 4, snapshot_hash: 'hash-4', status: 'candidate' },
    }).valid).toBe(false);
  });
});
