import { describe, expect, it } from 'vitest';
import {
  evaluateCommissionPolicySet,
  SYSTEM_COMMISSION_CAP,
  type CommissionPolicyRow,
} from '@/lib/affiliate/commission-policy-service';

const baseInput = {
  productId: 'product-1',
  destination: '다낭',
  affiliateId: 'affiliate-1',
  affiliateGrade: 2,
  daysSinceSignup: 10,
  baseRate: 0.02,
  tierBonus: 0.005,
  commissionBaseKrw: 1_000_000,
  computedAt: '2026-08-08T00:00:00.000Z',
  traceId: '00000000-0000-0000-0000-000000000001',
};

function policy(overrides: Partial<CommissionPolicyRow>): CommissionPolicyRow {
  return {
    id: 'policy-1',
    name: 'policy',
    trigger_type: 'always',
    trigger_config: {},
    action_type: 'commission_campaign_bonus',
    action_config: { rate: 0.01 },
    target_scope: { all: true },
    priority: 10,
    policy_version: 1,
    starts_at: null,
    ends_at: null,
    updated_at: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('commission policy SSOT', () => {
  it('combines product, tier and campaign rates under the mandatory cap', () => {
    const quote = evaluateCommissionPolicySet({
      ...baseInput,
      baseRate: 0.05,
      tierBonus: 0.01,
      policies: [policy({ action_config: { rate: 0.03 } })],
    });

    expect(quote.status).toBe('CALCULATED');
    if (quote.status !== 'CALCULATED') throw new Error('expected a calculated quote');
    expect(quote.finalRate).toBe(SYSTEM_COMMISSION_CAP);
    expect(quote.commissionAmountKrw).toBe(70_000);
    expect(quote.policySetVersion).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never applies a malformed trigger globally', () => {
    const quote = evaluateCommissionPolicySet({
      ...baseInput,
      policies: [policy({
        trigger_type: 'condition',
        trigger_config: { operator: '>=' },
        action_config: { rate: 0.04 },
      })],
    });

    expect(quote.status).toBe('CALCULATED');
    expect(quote.finalRate).toBe(0.025);
    expect(quote.breakdown).toMatchObject({
      ignored_policies: [{ policy_id: 'policy-1', reason: 'trigger_not_matched_or_malformed' }],
    });
  });

  it('holds instead of defaulting when product or tier rates are invalid', () => {
    const quote = evaluateCommissionPolicySet({ ...baseInput, baseRate: Number.NaN, policies: [] });
    expect(quote).toMatchObject({
      status: 'CALCULATION_HOLD',
      commissionAmountKrw: 0,
      reason: 'INVALID_PRODUCT_BASE_RATE',
    });
  });

  it('snapshots policy versions into the digest', () => {
    const first = evaluateCommissionPolicySet({ ...baseInput, policies: [policy({ policy_version: 1 })] });
    const second = evaluateCommissionPolicySet({ ...baseInput, policies: [policy({ policy_version: 2 })] });
    if (first.status !== 'CALCULATED' || second.status !== 'CALCULATED') {
      throw new Error('expected calculated quotes');
    }
    expect(first.policySetVersion).not.toBe(second.policySetVersion);
  });
});
