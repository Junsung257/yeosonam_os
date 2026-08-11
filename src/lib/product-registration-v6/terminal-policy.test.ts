import { describe, expect, it } from 'vitest';

import { evaluateProductRegistrationV6Policy } from './terminal-policy';

function canonical(input: { outcome?: 'verified' | 'degraded' | 'blocked'; prices?: unknown[] } = {}) {
  const outcome = input.outcome ?? 'verified';
  return {
    sections: [{
      completeness: {
        publicationOutcome: outcome,
        degradedReasons: outcome === 'degraded' ? ['flight_times: 운항 시간 최종 확인'] : [],
        blockers: outcome === 'blocked' ? ['price: 판매가 누락'] : [],
      },
      v3: {
        ledger: {
          variants: [{
            price_calendar: input.prices ?? [{ date: '2026-10-01', amount: 599000, currency: 'KRW' }],
            standard_notices: [{ category: 'cancellation_terms', raw_text: '취소료는 특별약관에 따릅니다.' }],
          }],
        },
      },
    }],
  };
}

describe('product registration V6 terminal policy', () => {
  it('publishes a fully verified product', () => {
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: canonical() });
    expect(result.terminalOutcome).toBe('published_verified');
  });

  it('publishes a safe degraded product without hiding the reason', () => {
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: canonical({ outcome: 'degraded' }) });
    expect(result.terminalOutcome).toBe('published_degraded');
    expect(result.degradedReasons).toHaveLength(1);
  });

  it('blocks a price not tied to a departure scope', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [{ amount: 599000, currency: 'KRW' }] }),
    });
    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.blockers.some(reason => reason.includes('출발일'))).toBe(true);
  });

  it('blocks a missing cancellation policy', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [];
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: payload });
    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(true);
  });

  it('accepts an approved, customer-visible cancellation policy snapshot', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [];
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      cancellationCoverage: [{
        revisionId: 'revision-1',
        catalogProductId: 'product-1',
        covered: true,
        policyHash: 'a'.repeat(64),
      }],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(false);
    expect(result.terminalOutcome).toBe('published_verified');
  });

  it('blocks when the frozen policy has no customer-visible cancellation notice', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      cancellationCoverage: [{
        revisionId: 'revision-1',
        catalogProductId: 'product-1',
        covered: false,
        policyHash: 'b'.repeat(64),
      }],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING:product-1'))).toBe(true);
  });

  it('does not mistake an unrelated refund notice for cancellation terms', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [{
      category: 'meal_refund',
      raw_text: '티업 시간 때문에 이용하지 못한 조식 비용은 환불되지 않습니다.',
    }];
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      termsTypes: ['refund'],
      sourceTexts: ['티업 시간 때문에 이용하지 못한 조식 비용은 환불되지 않습니다.'],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(true);
  });

  it('blocks tenant or source lineage mismatches', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      tenantId: 'tenant-a',
      sourceTenantId: 'tenant-b',
      sourceHash: 'a',
      expectedSourceHash: 'b',
    });
    expect(result.blockers.some(reason => reason.includes('SOURCE_HASH_MISMATCH'))).toBe(true);
    expect(result.blockers.some(reason => reason.includes('TENANT_LINEAGE_MISMATCH'))).toBe(true);
  });
});
