import { describe, expect, it } from 'vitest';

import { buildRegistrationTermsPolicySnapshot } from '@/lib/standard-terms';
import { assertApprovedBenchmarkCancellationPolicy } from './benchmark-policy';

function policy() {
  return {
    ...buildRegistrationTermsPolicySnapshot({
      notices: [{
        type: 'RESERVATION',
        title: '취소·환불 기준',
        text: '출발 30일 전까지 취소하면 전액 환불합니다.',
        surfaces: ['mobile'],
        _source: '플랫폼 기본약관',
        _tier: 1,
      }],
      templateRefs: [{
        id: 'template-1',
        name: '플랫폼 기본약관',
        tier: 1,
        version: 2,
        starts_at: '2026-01-01T00:00:00.000Z',
      }],
      surface: 'mobile',
    }),
    approval: {
      source: 'operational_current_template' as const,
      approvedAt: '2026-08-13T00:00:00.000Z',
      approvedBy: 'product-registration-operations',
    },
  };
}

describe('approved benchmark cancellation policy', () => {
  it('accepts a reproducible approved mobile policy snapshot', () => {
    expect(() => assertApprovedBenchmarkCancellationPolicy(policy())).not.toThrow();
  });

  it('rejects a forged policy hash', () => {
    const forged = { ...policy(), policy_hash: '0'.repeat(64) };
    expect(() => assertApprovedBenchmarkCancellationPolicy(forged))
      .toThrow('BENCHMARK_CANCELLATION_POLICY_HASH_MISMATCH');
  });

  it('rejects a policy without approval lineage', () => {
    const { approval: _approval, ...unapproved } = policy();
    expect(() => assertApprovedBenchmarkCancellationPolicy(unapproved))
      .toThrow('BENCHMARK_CANCELLATION_POLICY_APPROVAL_MISSING');
  });
});
