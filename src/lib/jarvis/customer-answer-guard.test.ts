import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ANSWER_GUARD_CASES,
  applyCustomerAnswerGuard,
  evaluateCustomerAnswerGuardCase,
} from './customer-answer-guard';

describe('customer answer guard', () => {
  it('passes the customer-facing guard corpus', () => {
    const results = CUSTOMER_ANSWER_GUARD_CASES.map(evaluateCustomerAnswerGuardCase);

    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('does not rewrite internal admin answers', () => {
    const result = applyCustomerAnswerGuard({
      message: '환불 처리해주세요',
      reply: '환불 처리했습니다.',
      ctx: { userRole: 'platform_admin', surface: 'admin' },
    });

    expect(result.wasGuarded).toBe(false);
    expect(result.reply).toBe('환불 처리했습니다.');
  });

  it('does not rewrite responses that are waiting for HITL approval', () => {
    const result = applyCustomerAnswerGuard({
      message: '예약 취소해주세요',
      reply: '담당자 승인 후 처리할 수 있습니다.',
      ctx: { userRole: 'customer', surface: 'customer' },
      pendingActionId: 'pending-1',
    });

    expect(result.wasGuarded).toBe(false);
  });
});
