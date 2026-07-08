import { describe, expect, it } from 'vitest';

import {
  customerOpenBatchStage,
  selectCustomerOpenBatchCandidates,
  type CustomerOpenBatchCandidateRow,
} from './customer-open-batch-candidates';

function row(input: Partial<CustomerOpenBatchCandidateRow>): CustomerOpenBatchCandidateRow {
  return {
    id: input.id ?? crypto.randomUUID(),
    internal_code: input.internal_code ?? null,
    title: input.title ?? null,
    status: input.status ?? 'pending_review',
    audit_report: input.audit_report ?? {},
    updated_at: input.updated_at ?? null,
  };
}

describe('customer open batch candidate selection', () => {
  it('skips already prepared ready_not_opened packages by default', () => {
    const candidates = selectCustomerOpenBatchCandidates([
      row({
        id: 'ready',
        audit_report: { upload_to_open_autopilot: { stage: 'ready_not_opened' } },
      }),
      row({
        id: 'blocked',
        audit_report: { upload_to_open_autopilot: { stage: 'blocked_after_mobile_proof' } },
      }),
      row({ id: 'fresh', audit_report: {} }),
    ], { limit: 10 });

    expect(candidates.map(candidate => candidate.id)).toEqual(['fresh']);
  });

  it('can include ready and retry errored rows only when explicitly requested', () => {
    const rows = [
      row({
        id: 'ready',
        audit_report: { upload_to_open_autopilot: { stage: 'ready_not_opened' } },
      }),
      row({
        id: 'error',
        audit_report: { upload_to_open_autopilot: { stage: 'error' } },
      }),
    ];

    expect(selectCustomerOpenBatchCandidates(rows, { limit: 10 }).map(candidate => candidate.id)).toEqual([]);
    expect(selectCustomerOpenBatchCandidates(rows, { limit: 10, includeReady: true, retryErrors: true }).map(candidate => candidate.id))
      .toEqual(['ready', 'error']);
  });

  it('returns the current autopilot stage from audit_report', () => {
    expect(customerOpenBatchStage(row({
      audit_report: { upload_to_open_autopilot: { stage: 'mobile_repair_started' } },
    }))).toBe('mobile_repair_started');
  });
});
