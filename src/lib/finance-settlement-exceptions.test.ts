import { describe, expect, it } from 'vitest';

import { buildSettlementExceptionUpdate } from './finance-settlement-exceptions';

describe('finance settlement exception updates', () => {
  it('preserves responsibility fields when only resolving an exception', () => {
    expect(buildSettlementExceptionUpdate(
      { status: 'resolved' },
      'owner@example.com',
      '2026-08-05T12:00:00.000Z',
    )).toEqual({
      status: 'resolved',
      resolved_at: '2026-08-05T12:00:00.000Z',
      resolved_by: 'owner@example.com',
    });
  });

  it('updates only responsibility fields explicitly supplied by the operator', () => {
    expect(buildSettlementExceptionUpdate({
      status: 'open',
      assignedTo: ' 재무 담당자 ',
      reason: '',
      dueDate: '2026-08-12',
    }, 'owner')).toEqual({
      status: 'open',
      assigned_to: '재무 담당자',
      reason: null,
      due_date: '2026-08-12',
    });
  });
});
