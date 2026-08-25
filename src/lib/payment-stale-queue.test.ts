import { describe, expect, it } from 'vitest';
import {
  buildStalePaymentAttentionQueue,
  getStalePaymentAttentionRows,
  isStalePaymentAttentionRow,
} from './payment-stale-queue';

const NOW = Date.parse('2026-08-25T06:00:00.000Z');

describe('payment stale queue', () => {
  it('includes old travel outflows that still need review', () => {
    expect(isStalePaymentAttentionRow({
      created_at: '2026-08-24T05:59:59.000Z',
      match_status: 'review',
      settlement_scope: 'travel',
    }, NOW)).toBe(true);
  });

  it('uses one filtered result for the queue count and visible rows', () => {
    const rows = [
      { id: 'oldest-outflow', transaction_type: '출금', is_refund: false, created_at: '2026-08-01T00:00:00.000Z', match_status: 'review', settlement_scope: 'travel' },
      { id: 'stale-error', transaction_type: '출금', is_refund: false, created_at: '2026-08-20T00:00:00.000Z', match_status: 'error', settlement_scope: 'travel' },
      { id: 'recent-review', transaction_type: '출금', is_refund: false, created_at: '2026-08-25T05:30:00.000Z', match_status: 'review', settlement_scope: 'travel' },
      { id: 'matched', transaction_type: '출금', is_refund: false, created_at: '2026-08-01T00:00:00.000Z', match_status: 'manual', settlement_scope: 'travel' },
      { id: 'company-expense', transaction_type: '출금', is_refund: false, created_at: '2026-08-01T00:00:00.000Z', match_status: 'review', settlement_scope: 'non_travel' },
    ];

    const staleRows = getStalePaymentAttentionRows(rows, NOW);

    expect(staleRows.map(row => row.id)).toEqual(['oldest-outflow', 'stale-error']);
    expect(staleRows).toHaveLength(2);
  });

  it('returns one source of truth for the card count and visible outflow rows', () => {
    const fourOldOutflows = Array.from({ length: 4 }, (_, index) => ({
      id: `outflow-${index + 1}`,
      transaction_type: '출금',
      is_refund: false,
      created_at: `2026-08-0${index + 1}T00:00:00.000Z`,
      match_status: 'review',
      settlement_scope: 'travel',
    }));

    const queue = buildStalePaymentAttentionQueue(fourOldOutflows, NOW);

    expect(queue.count).toBe(4);
    expect(queue.rows).toHaveLength(queue.count);
    expect(queue.rows.map(row => row.id)).toEqual([
      'outflow-1',
      'outflow-2',
      'outflow-3',
      'outflow-4',
    ]);
  });

  it('rejects missing or invalid timestamps', () => {
    expect(isStalePaymentAttentionRow({ match_status: 'review', settlement_scope: 'travel' }, NOW)).toBe(false);
    expect(isStalePaymentAttentionRow({ created_at: 'invalid', match_status: 'review', settlement_scope: 'travel' }, NOW)).toBe(false);
  });
});
