import { describe, expect, it } from 'vitest';
import { checkAnswerExtractability, checkFactIntegrity } from './blog-quality-gate';

describe('blog quality gate v2 fact integrity', () => {
  it('rechecks the final body against product fact policy', () => {
    const gate = checkFactIntegrity({
      blog_html: '# 다낭 패키지\n\n등록 데이터 기준 899,000원~입니다.\n\n후처리 문구: 1,500,000원 절약 가능합니다.',
      slug: 'danang-package',
      blog_type: 'product',
      fact_integrity: { passed: true, issues: [] },
      fact_policy: {
        mode: 'product',
        allowedMoneyClaims: ['899000'],
        blockedClaims: ['절약'],
      },
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('1,500,000원');
    expect(gate.reason).toContain('절약');
  });

  it('passes when final body only uses product-approved money claims', () => {
    const gate = checkFactIntegrity({
      blog_html: '# 다낭 패키지\n\n등록 데이터 기준 899,000원~입니다.',
      slug: 'danang-package',
      blog_type: 'product',
      fact_integrity: { passed: true, issues: [] },
      fact_policy: {
        mode: 'product',
        allowedMoneyClaims: ['899000'],
        blockedClaims: ['절약'],
      },
    });

    expect(gate.passed).toBe(true);
  });

  it('passes answer extractability for answer-first question sections', () => {
    const gate = checkAnswerExtractability({
      blog_html: [
        '# 다낭 패키지',
        '',
        '## 핵심 답변',
        '',
        '**답변:** 다낭 3박 5일 패키지는 등록된 상품 데이터 기준 899,000원부터 확인할 수 있습니다.',
        '포함사항과 불포함사항, 일정, 출발 조건을 함께 확인해야 합니다.',
        '',
        '## 다낭 3박 5일 상품 가격과 출발 조건은 무엇인가요?',
        '',
        '등록 데이터 기준 가격과 출발 조건을 확인합니다.',
        '',
        '## 포함사항과 불포함사항은 무엇인가요?',
        '',
        '포함사항과 불포함사항을 나눠 확인합니다.',
        '',
        '## 예약 전 어떤 유의사항을 확인해야 하나요?',
        '',
        '출발일, 좌석, 객실 조건을 확인합니다.',
      ].join('\n'),
      slug: 'danang-package',
      blog_type: 'product',
    });

    expect(gate.passed).toBe(true);
  });

  it('fails answer extractability when there is no direct answer block', () => {
    const gate = checkAnswerExtractability({
      blog_html: [
        '# 다낭 패키지',
        '',
        '다낭은 아름다운 여행지입니다. 오래 기억될 여행을 준비해보세요.',
        '',
        '## 여행 분위기',
        '',
        '감성적인 설명만 이어집니다.',
        '',
        '## 추천 포인트',
        '',
        '구체 답변 없이 소개합니다.',
      ].join('\n'),
      slug: 'danang-package',
      blog_type: 'product',
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('answer extractability failed');
  });
});
