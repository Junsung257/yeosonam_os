import { describe, expect, it } from 'vitest';

import {
  auditCustomerVisibleProductText,
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from './customer-visible-text-audit';

describe('customer visible text audit v2', () => {
  it('marks safe supplier notation as repairable instead of final blocking', () => {
    const issues = auditCustomerVisibleProductText({
      inclusions: ['특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)'],
    });

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['supplier_notation']));
    expect(issues.every(issue => issue.safeFixable)).toBe(true);
    expect(blockingCustomerVisibleTextIssues({
      inclusions: ['특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)'],
    })).toEqual([]);
  });

  it('detects duplicate destination tokens and cross-field duplicate phrases', () => {
    const issues = auditCustomerVisibleProductText({
      title: '다낭 다낭 핵심 패키지',
      inclusions: ['바나산 정상 레스토랑 저녁식사'],
      optional_tours: [{ name: '바나산 정상 레스토랑 저녁식사' }],
    });

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_destination_token',
      'optional_inclusion_duplicate',
    ]));
  });

  it('keeps unsafe internal and mojibake text blocking', () => {
    const issues = blockingCustomerVisibleTextIssues({
      customer_notes: ['랜드사 NET 기준으로 마진 확인', '????'],
    });

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'customer_forbidden_internal_terms',
      'placeholder_or_mojibake',
    ]));
  });

  it('audits actual screen text by line and surface', () => {
    const issues = auditCustomerVisibleScreenText([
      '다낭 다낭 베스트 상품',
      '바나힐 방문합니다',
      '특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)',
    ].join('\n'), { surface: 'lp' });

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_destination_token',
      'low_information_action_sentence',
      'supplier_notation',
    ]));
    expect(issues.every(issue => issue.surface === 'lp')).toBe(true);
  });
});
