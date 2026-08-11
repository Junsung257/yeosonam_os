import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV5ProofRow } from './proof';

describe('V5 proof persistence contract', () => {
  it('binds a proof row to the exact snapshot, renderer and route', () => {
    const row = buildProductRegistrationV5ProofRow({
      packageId: 'package',
      revisionId: 'revision',
      publicSnapshotId: 'snapshot',
      snapshotHash: 'a'.repeat(64),
      rendererBuildId: 'build-1',
      proofSuiteVersion: 'mobile-proof-v1',
      route: '/packages/package',
      viewport: { width: 390, height: 844 },
      status: 'passed',
      result: { checks: [{ name: 'cta', ok: true }] },
    });
    expect(row).toMatchObject({
      package_id: 'package',
      revision_id: 'revision',
      public_snapshot_id: 'snapshot',
      snapshot_hash: 'a'.repeat(64),
      renderer_build_id: 'build-1',
      status: 'passed',
    });
  });

  it('rejects a proof without a cryptographic snapshot hash', () => {
    expect(() => buildProductRegistrationV5ProofRow({
      packageId: 'package',
      revisionId: 'revision',
      publicSnapshotId: 'snapshot',
      snapshotHash: 'invalid',
      rendererBuildId: 'build-1',
      proofSuiteVersion: 'mobile-proof-v1',
      route: '/packages/package',
      viewport: { width: 390, height: 844 },
      status: 'passed',
      result: {},
    })).toThrow('V5_PROOF_SNAPSHOT_HASH_INVALID');
  });
});
