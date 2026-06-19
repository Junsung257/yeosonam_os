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

  it('does not retry v2 product data and fact integrity failures', () => {
    expect(classifyBlogQueueFailure('needs_product_data:missing_price')).toMatchObject({
      code: 'product_data_missing',
      retryable: false,
      selfHealAllowed: false,
    });

    expect(classifyBlogQueueFailure('fact_integrity_failed:unsupported_money_claim')).toMatchObject({
      code: 'fact_integrity',
      retryable: false,
      selfHealAllowed: false,
    });

    expect(shouldSelfHealBlogQueueItem({
      lastError: 'fact_integrity_failed:unsupported_money_claim',
    })).toBe(false);
  });

  it('treats source and distribution integrity failures as non-retryable', () => {
    expect(classifyBlogQueueFailure('needs_source_review:missing_trusted_sources')).toMatchObject({
      code: 'source_coverage',
      retryable: false,
      selfHealAllowed: false,
    });

    expect(classifyBlogQueueFailure('distribution_integrity: full blog body')).toMatchObject({
      code: 'distribution_integrity',
      retryable: false,
      skipped: true,
    });
  });

  it('allows publisher retry but blocks self-heal for answer extractability failures', () => {
    const qa = {
      gates: [
        { gate: 'answer_extractability', passed: false },
      ],
    };

    expect(classifyBlogQueueFailure('answer_extractability failed', qa)).toMatchObject({
      code: 'answer_extractability',
      retryable: true,
      selfHealAllowed: false,
    });

    expect(shouldSelfHealBlogQueueItem({
      lastError: 'answer_extractability failed',
    })).toBe(false);
  });
});
