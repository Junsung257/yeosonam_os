import { describe, expect, it } from 'vitest';
import { evaluateCustomerInquiryContracts } from './customer-inquiry-contracts';

describe('customer inquiry external channel and admin contracts', () => {
  it('keeps Kakao, escalation, and admin Jarvis wiring present', () => {
    const summary = evaluateCustomerInquiryContracts();

    expect(summary.status).toBe('pass');
    expect(summary.score).toBe(100);
    expect(summary.failed).toBe(0);
  });
});
