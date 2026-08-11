import { describe, expect, it } from 'vitest';

import { summarizeProductRegistrationV5OperationalRows } from './operational-audit';

describe('V5 operational audit summary', () => {
  it('marks pending, stale, failed and non-public lineage as blockers', () => {
    const result = summarizeProductRegistrationV5OperationalRows({
      convergence: [
        { status: 'pending' },
        { status: 'stale' },
        { status: 'failed' },
      ],
      outbox: [{ status: 'dead_letter' }],
      pointers: [{ state: 'draft' }],
      revisions: [{ status: 'needs_review' }],
    });

    expect(result.healthy).toBe(false);
    expect(result.blockers).toEqual([
      'CONVERGENCE_PENDING',
      'CONVERGENCE_STALE',
      'CONVERGENCE_FAILED',
      'OUTBOX_DEAD_LETTER',
      'POINTER_NOT_PUBLIC',
      'REVISION_NOT_PUBLISHABLE',
    ]);
  });

  it('reports a clean sample when all observed surfaces and pointers are public', () => {
    const result = summarizeProductRegistrationV5OperationalRows({
      convergence: [{ status: 'converged' }, { status: 'converged' }],
      outbox: [{ status: 'delivered' }],
      pointers: [{ state: 'published' }],
      revisions: [{ status: 'published' }],
    });

    expect(result).toMatchObject({ healthy: true, blockers: [] });
    expect(result.summary.convergence.byStatus).toEqual({ converged: 2 });
  });

  it('does not call an empty V5 database healthy', () => {
    const result = summarizeProductRegistrationV5OperationalRows({
      convergence: [],
      outbox: [],
      pointers: [],
      revisions: [],
    });
    expect(result).toMatchObject({ healthy: false, blockers: ['NO_V5_SAMPLE'] });
  });

  it('ignores immutable convergence history for superseded snapshots', () => {
    const result = summarizeProductRegistrationV5OperationalRows({
      convergence: [
        { snapshot_id: 'old', status: 'stale' },
        { snapshot_id: 'current', status: 'converged' },
      ],
      outbox: [{ status: 'delivered' }],
      pointers: [{ state: 'published' }],
      revisions: [{ status: 'approved' }],
      activeSnapshotIds: ['current'],
    });

    expect(result).toMatchObject({
      healthy: true,
      blockers: [],
      summary: { convergence: { total: 1, byStatus: { converged: 1 } } },
    });
  });

  it('blocks a published pointer with no active convergence result', () => {
    const result = summarizeProductRegistrationV5OperationalRows({
      convergence: [{ snapshot_id: 'old', status: 'converged' }],
      outbox: [{ status: 'delivered' }],
      pointers: [{ state: 'published' }],
      revisions: [{ status: 'approved' }],
      activeSnapshotIds: ['current'],
    });

    expect(result.blockers).toContain('CONVERGENCE_MISSING');
    expect(result.healthy).toBe(false);
  });
});
