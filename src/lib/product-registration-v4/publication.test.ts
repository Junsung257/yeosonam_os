import { describe, expect, it, vi } from 'vitest';

import { publishProductRegistrationV5SnapshotAtomic } from './publication';

describe('retired V5 publication adapter', () => {
  it('always rejects without calling a database publication RPC', async () => {
    const rpc = vi.fn();
    await expect(publishProductRegistrationV5SnapshotAtomic({
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
    })).rejects.toThrow('V5_PUBLICATION_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
    expect(rpc).not.toHaveBeenCalled();
  });
});
