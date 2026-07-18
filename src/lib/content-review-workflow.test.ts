import { describe, expect, it } from 'vitest';

import {
  resolveContentReviewAutoApprovalPolicy,
  selectAutoApprovableReviewItems,
  type AutoApprovalCandidate,
} from './content-review-workflow';

describe('resolveContentReviewAutoApprovalPolicy', () => {
  it('keeps the existing 48-hour default for low-risk reviews', () => {
    expect(resolveContentReviewAutoApprovalPolicy({ riskLevel: 'low' })).toEqual({
      autoApproveAfterHours: 48,
      requiresHumanReview: false,
    });
  });

  it.each(['high', 'critical'] as const)(
    'disables timed auto-approval for %s-risk reviews',
    (riskLevel) => {
      expect(resolveContentReviewAutoApprovalPolicy({
        riskLevel,
        autoApproveAfterHours: 1,
      })).toEqual({
        autoApproveAfterHours: null,
        requiresHumanReview: true,
      });
    },
  );

  it('lets an explicit human-review requirement override a requested timeout', () => {
    expect(resolveContentReviewAutoApprovalPolicy({
      humanReviewRequired: true,
      autoApproveAfterHours: 2,
    })).toEqual({
      autoApproveAfterHours: null,
      requiresHumanReview: true,
    });
  });

  it('treats null, zero, and invalid timeouts as no auto-approval', () => {
    expect(resolveContentReviewAutoApprovalPolicy({ autoApproveAfterHours: null }).autoApproveAfterHours).toBeNull();
    expect(resolveContentReviewAutoApprovalPolicy({ autoApproveAfterHours: 0 }).autoApproveAfterHours).toBeNull();
    expect(resolveContentReviewAutoApprovalPolicy({ autoApproveAfterHours: Number.NaN }).autoApproveAfterHours).toBeNull();
  });
});

describe('selectAutoApprovableReviewItems', () => {
  const nowMs = Date.parse('2026-07-15T12:00:00.000Z');
  const base: AutoApprovalCandidate = {
    id: 'queue-1',
    creative_id: 'creative-1',
    priority: 10,
    auto_approve_after_hours: 48,
    created_at: '2026-07-13T11:59:59.000Z',
  };

  it('selects an elapsed, low-priority, opt-in row', () => {
    expect(selectAutoApprovableReviewItems([base], nowMs).map(row => row.id)).toEqual(['queue-1']);
  });

  it('never selects human-required rows represented by a null timeout', () => {
    expect(selectAutoApprovableReviewItems([
      { ...base, auto_approve_after_hours: null },
    ], nowMs)).toEqual([]);
  });

  it('honors each row timeout and excludes high-priority or invalid rows', () => {
    const rows: AutoApprovalCandidate[] = [
      { ...base, id: 'not-expired', created_at: '2026-07-14T12:00:01.000Z', auto_approve_after_hours: 24 },
      { ...base, id: 'high-priority', priority: 30 },
      { ...base, id: 'missing-creative', creative_id: null },
      { ...base, id: 'invalid-date', created_at: 'not-a-date' },
      { ...base, id: 'custom-expired', created_at: '2026-07-15T09:59:59.000Z', auto_approve_after_hours: 2 },
    ];

    expect(selectAutoApprovableReviewItems(rows, nowMs).map(row => row.id)).toEqual(['custom-expired']);
  });
});
