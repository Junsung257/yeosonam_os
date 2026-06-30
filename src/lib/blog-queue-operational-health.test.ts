import { describe, expect, it } from 'vitest';
import {
  classifyBlogQueueOperationalIssue,
  getBlogQueueOperationalState,
  summarizeBlogQueueOperationalHealth,
} from './blog-queue-operational-health';

describe('blog queue operational health', () => {
  it('classifies product open-contract failures even when stored failure_code is unknown', () => {
    const row = {
      status: 'failed',
      attempts: 1,
      last_error: 'product_customer_open_contract_failed:mobile_proof stale for current package',
      meta: { failure_code: 'unknown' },
    };

    expect(classifyBlogQueueOperationalIssue(row)).toBe('product_open_contract');
    expect(getBlogQueueOperationalState(row)).toMatchObject({
      attention: false,
      manualReview: true,
      retryable: false,
      terminal: true,
      action: 'collect_product_evidence',
    });
  });

  it('keeps quarantined editorial failures out of actionable failed counts', () => {
    const summary = summarizeBlogQueueOperationalHealth([
      {
        status: 'failed',
        attempts: 1,
        last_error: '1/19 failed: [intent_quality] early_strong_cta',
        meta: {
          failure_code: 'intent_quality',
          quarantine_reason: 'intent_quality',
          self_heal_blocked: true,
        },
      },
      {
        status: 'failed',
        attempts: 0,
        last_error: 'temporary database timeout',
        meta: {},
      },
    ]);

    expect(summary.actionable_failed_count).toBe(1);
    expect(summary.manual_review_count).toBe(1);
    expect(summary.action_counts).toMatchObject({
      editorial_backlog: 1,
      retry_failed: 1,
    });
  });

  it('marks old generating rows as stale recovery work', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const state = getBlogQueueOperationalState({
      status: 'generating',
      attempts: 1,
      updated_at: '2026-06-30T23:00:00.000Z',
    }, now);

    expect(state).toMatchObject({
      attention: true,
      retryable: true,
      action: 'recover_stale_generating',
    });
  });
});
