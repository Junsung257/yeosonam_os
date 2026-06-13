import { describe, expect, it } from 'vitest';
import {
  classifyBlogQueueFailure,
  shouldSelfHealBlogQueueItem,
} from './blog-queue-failure-policy';

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

  it('keeps deterministic quality failures eligible for repair', () => {
    const decision = classifyBlogQueueFailure('1/13 failed: [structure_integrity] checklist_shape_invalid');

    expect(decision).toMatchObject({
      code: 'structure_integrity',
      retryable: true,
      selfHealAllowed: true,
    });
    expect(shouldSelfHealBlogQueueItem({
      lastError: '1/13 failed: [structure_integrity] checklist_shape_invalid',
    })).toBe(true);
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
});
