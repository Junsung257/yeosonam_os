import { describe, expect, it } from 'vitest';
import { buildBlogProductEvidenceRecheckDecision } from './blog-product-evidence-recheck';

describe('blog product evidence recheck', () => {
  it('clears product open-contract quarantine when the package now passes', () => {
    const decision = buildBlogProductEvidenceRecheckDecision({
      checkedAt: '2026-07-01T00:00:00.000Z',
      contractOk: true,
      meta: {
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_open_contract',
        self_heal_blocked: true,
        product_open_contract_blockers: ['mobile_proof:stale'],
        keep_me: 'yes',
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.last_error).toBeNull();
    expect(decision.meta).toMatchObject({
      keep_me: 'yes',
      product_open_contract_recheck_result: 'pass',
      requeued_by: 'blog-product-evidence-recheck',
    });
    expect(decision.meta).not.toHaveProperty('failure_code');
    expect(decision.meta).not.toHaveProperty('quarantine_reason');
    expect(decision.meta).not.toHaveProperty('self_heal_blocked');
  });

  it('keeps blocked rows blocked with current blockers', () => {
    const decision = buildBlogProductEvidenceRecheckDecision({
      checkedAt: '2026-07-01T00:00:00.000Z',
      contractOk: false,
      blockers: ['mobile_proof:stale', 'quality_scorecard:packages_mobile'],
      meta: { previous: true },
    });

    expect(decision).toMatchObject({
      action: 'keep_blocked',
      last_error: 'product_customer_open_contract_failed:mobile_proof:stale|quality_scorecard:packages_mobile',
      meta: {
        previous: true,
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_open_contract',
        self_heal_blocked: true,
        product_open_contract_blockers: ['mobile_proof:stale', 'quality_scorecard:packages_mobile'],
        product_open_contract_recheck_result: 'blocked',
      },
    });
  });
});
