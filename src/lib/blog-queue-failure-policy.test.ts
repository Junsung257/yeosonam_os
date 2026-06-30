import { describe, expect, it } from 'vitest';
import {
  classifyBlogQueueFailure,
  shouldSelfHealBlogQueueItem,
} from './blog-queue-failure-policy';
import { shouldQuarantineQueuedBlogItem } from './blog-queue-lifecycle';

describe('blog queue failure policy', () => {
  it('blocks self-heal for missing pillar context', () => {
    const decision = classifyBlogQueueFailure('푸꾸옥 context missing: attractions+packages 0');

    expect(decision).toMatchObject({
      code: 'context_missing',
      retryable: false,
      selfHealAllowed: false,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '푸꾸옥 context missing: attractions+packages 0',
    })).toBe(false);
  });

  it('allows one publisher retry for quality failures but blocks orchestrator self-heal loops', () => {
    const decision = classifyBlogQueueFailure('1/13 failed: [structure_integrity] checklist_shape_invalid');

    expect(decision).toMatchObject({
      code: 'structure_integrity',
      retryable: true,
      selfHealAllowed: false,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '1/13 failed: [structure_integrity] checklist_shape_invalid',
    })).toBe(false);
  });

  it('honors stored quarantine metadata even if the text is ambiguous', () => {
    expect(shouldSelfHealBlogQueueItem({
      lastError: 'self-heal blocked',
      meta: {
        failure_code: 'context_missing',
        self_heal_blocked: true,
      },
    })).toBe(false);
  });

  it('preflight-quarantines queued duplicate rows instead of reclaiming them', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: 'duplicate slug already exists',
      meta: {},
    })).toMatchObject({
      quarantine: true,
      status: 'skipped',
      reason: 'duplicate_content',
    });
  });

  it('preflight-keeps retryable queued rows under the attempt limit', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 1,
      lastError: 'temporary database timeout',
      meta: {},
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: false,
    });
  });

  it('preflight-quarantines retryable rows after the attempt limit', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 2,
      lastError: 'temporary database timeout',
      meta: {},
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'db_write',
    });
  });

  it('preflight-quarantines evidence-insufficient candidates before another claim', () => {
    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: null,
      meta: { evidence_insufficient: true },
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'evidence_insufficient',
    });
  });

  it('treats product open-contract failures as non-retryable publisher blockers', () => {
    expect(classifyBlogQueueFailure(
      'product_customer_open_contract_failed:mobile_proof:actual /packages mobile browser proof is stale',
    )).toMatchObject({
      code: 'product_open_contract',
      retryable: false,
      selfHealAllowed: false,
      skipped: false,
    });

    expect(shouldQuarantineQueuedBlogItem({
      attempts: 0,
      lastError: 'product_customer_open_contract_failed:mobile_proof:actual customer mobile browser proof hashes are missing',
      meta: {},
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'product_open_contract',
    });
  });

  it('does not let stored unknown failure_code hide a product open-contract blocker', () => {
    expect(shouldSelfHealBlogQueueItem({
      lastError: 'product_customer_open_contract_failed:mobile_proof stale',
      meta: { failure_code: 'unknown' },
    })).toBe(false);

    expect(shouldQuarantineQueuedBlogItem({
      attempts: 1,
      lastError: 'product_customer_open_contract_failed:mobile_proof stale',
      meta: { failure_code: 'unknown' },
      maxAttempts: 2,
    })).toMatchObject({
      quarantine: true,
      status: 'failed',
      reason: 'product_open_contract',
    });
  });
});
