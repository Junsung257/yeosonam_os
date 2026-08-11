import { describe, expect, it } from 'vitest';

import { buildCustomerFaqs } from './PackageFAQ';

describe('buildCustomerFaqs', () => {
  it('does not invent cancellation percentages or generic baggage allowances', () => {
    const questions = buildCustomerFaqs({ destination: '후쿠오카', minParticipants: 4 });
    const text = questions.map((item) => `${item.question} ${item.answer}`).join('\n');

    expect(text).toContain('최소 4명 출발 조건');
    expect(text).toContain('항공사와 상품별로 다를 수');
    expect(text).not.toContain('출발 30일 전');
    expect(text).not.toContain('20kg');
    expect(text).not.toContain('10kg');
  });

  it('uses only explicit product facts for guide, baggage, and cancellation answers', () => {
    const questions = buildCustomerFaqs({
      destination: '후쿠오카',
      minParticipants: 4,
      inclusions: ['왕복항공료', '골프수하물 23KG', '한국인가이드'],
      notices: ['출발 30일 전까지 취소 시 전액 환불'],
    });
    const text = questions.map((item) => `${item.question} ${item.answer}`).join('\n');

    expect(text).toContain('골프수하물 23KG');
    expect(text).toContain('한국인가이드');
    expect(text).toContain('출발 30일 전까지 취소 시 전액 환불');
  });
});
