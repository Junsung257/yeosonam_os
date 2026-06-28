import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_INQUIRY_SCENARIOS,
  CUSTOMER_SUPPORT_SOP_MATRIX,
  evaluateCustomerInquiryReadiness,
  evaluateCustomerInquiryScenario,
} from './customer-inquiry-readiness';

describe('customer inquiry readiness', () => {
  it('passes the customer inquiry scenario set', () => {
    const summary = evaluateCustomerInquiryReadiness();

    expect(summary.status).toBe('pass');
    expect(summary.score).toBe(100);
    expect(summary.passed).toBe(CUSTOMER_INQUIRY_SCENARIOS.length);
  });

  it('approval-gates Korean refund, payment cancel, and price mutation requests', () => {
    const ids = ['refund-critical', 'payment-cancel-critical', 'price-discount-high'];
    const results = CUSTOMER_INQUIRY_SCENARIOS
      .filter((scenario) => ids.includes(scenario.id))
      .map(evaluateCustomerInquiryScenario);

    for (const result of results) {
      expect(result.passed, result.id).toBe(true);
      expect(result.checks.find((check) => check.name === 'requires_approval')?.actual).toBe(true);
    }
  });

  it('keeps customer guest tools read-only', () => {
    const result = evaluateCustomerInquiryScenario(
      CUSTOMER_INQUIRY_SCENARIOS.find((scenario) => scenario.id === 'guest-tool-catalog-readonly')!,
    );

    expect(result.passed).toBe(true);
    expect(result.checks.filter((check) => check.name.startsWith('guest_blocks_')).every((check) => check.actual === false)).toBe(true);
  });

  it('covers professional support SOPs with evidence and handoff rules', () => {
    const sopResults = CUSTOMER_INQUIRY_SCENARIOS
      .filter((scenario) => scenario.category === 'sop')
      .map(evaluateCustomerInquiryScenario);

    expect(CUSTOMER_SUPPORT_SOP_MATRIX.length).toBeGreaterThanOrEqual(10);
    expect(sopResults).toHaveLength(CUSTOMER_SUPPORT_SOP_MATRIX.length);
    expect(sopResults.every((result) => result.passed)).toBe(true);
    expect(sopResults.some((result) => result.checks.some((check) => check.name === 'sop_handoff_required' && check.actual === true))).toBe(true);
    expect(sopResults.every((result) => result.checks.some((check) => check.name === 'sop_forbidden_auto_execute' && check.actual === true))).toBe(true);
  });
});
