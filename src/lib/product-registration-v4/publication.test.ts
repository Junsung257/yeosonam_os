import { describe, expect, it, vi } from 'vitest';

import { publishProductRegistrationV5SnapshotAtomic } from './publication';

describe('V5 publication adapter', () => {
  it('rejects an invalid lineage before making an RPC call', async () => {
    const rpc = vi.fn();
    await expect(publishProductRegistrationV5SnapshotAtomic({
      supabase: { rpc } as never,
      publication: {
        packageId: '',
        revisionId: 'revision',
        snapshotId: 'snapshot',
        snapshotHash: 'a'.repeat(64),
        proofRunId: 'proof',
        expectedPointerVersion: 0,
        idempotencyKey: 'idempotency',
      },
    })).rejects.toThrow('V5_PUBLICATION_LINEAGE_REQUIRED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes only immutable publication identifiers to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        package_id: 'package',
        revision_id: 'revision',
        snapshot_id: 'snapshot',
        snapshot_hash: 'a'.repeat(64),
        proof_run_id: 'proof',
        pointer_version: 1,
        publication_state: 'published',
        policy_version: 'policy',
      },
      error: null,
    });
    const result = await publishProductRegistrationV5SnapshotAtomic({
      supabase: { rpc } as never,
      publication: {
        packageId: 'package',
        revisionId: 'revision',
        snapshotId: 'snapshot',
        snapshotHash: 'a'.repeat(64),
        proofRunId: 'proof',
        expectedPointerVersion: 0,
        idempotencyKey: 'idempotency',
      },
    });
    expect(result.pointer_version).toBe(1);
    expect(rpc).toHaveBeenCalledWith('publish_product_registration_v5_snapshot_atomic', expect.objectContaining({
      p_package_id: 'package',
      p_revision_id: 'revision',
      p_snapshot_id: 'snapshot',
      p_proof_run_id: 'proof',
      p_expected_pointer_version: 0,
      p_idempotency_key: 'idempotency',
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_package_patch');
  });
});
