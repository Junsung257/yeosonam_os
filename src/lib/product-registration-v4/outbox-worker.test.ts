import { describe, expect, it } from 'vitest';

import {
  buildProductRegistrationV5ConvergenceRows,
  parseProductRegistrationV5OutboxPayload,
} from './outbox-worker';

describe('V5 publication outbox worker contracts', () => {
  it('accepts only source-bound publication payloads', () => {
    expect(parseProductRegistrationV5OutboxPayload({
      package_id: 'package-1',
      revision_id: 'revision-1',
      snapshot_id: 'snapshot-1',
      snapshot_hash: 'A'.repeat(64),
    })).toEqual({
      package_id: 'package-1',
      revision_id: 'revision-1',
      snapshot_id: 'snapshot-1',
      snapshot_hash: 'a'.repeat(64),
    });
    expect(parseProductRegistrationV5OutboxPayload({ package_id: 'package-1', snapshot_hash: 'not-a-hash' })).toBeNull();
  });

  it('creates pending convergence records for every customer surface', () => {
    const rows = buildProductRegistrationV5ConvergenceRows({
      payload: {
        package_id: 'package-1',
        catalog_product_id: 'catalog-1',
        revision_id: 'revision-1',
        snapshot_id: 'snapshot-1',
        snapshot_hash: 'a'.repeat(64),
      },
      shortCode: 'summer-asia',
    });

    expect(rows.map(row => row.route)).toEqual([
      '/packages/package-1',
      '/lp/package-1',
      '/lp/summer-asia',
      '/api/og/affiliate?pkg=package-1',
      '/api/og/affiliate?pkg=package-1',
    ]);
    expect(rows.every(row => row.status === 'pending')).toBe(true);
    expect(rows.every(row => row.catalog_product_id === 'catalog-1')).toBe(true);
  });
});
