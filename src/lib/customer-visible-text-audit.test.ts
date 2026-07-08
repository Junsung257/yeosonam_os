import { describe, expect, it } from 'vitest';

import {
  auditCustomerVisibleProductText,
  auditCustomerVisibleScreenText,
  blockingCustomerVisibleTextIssues,
} from './customer-visible-text-audit';

describe('customer visible text audit v2', () => {
  it('marks safe supplier notation as repairable instead of final blocking', () => {
    const payload = {
      inclusions: ['특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔'],
    };
    const issues = auditCustomerVisibleProductText(payload);

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['supplier_notation']));
    expect(issues.every(issue => issue.safeFixable)).toBe(true);
    expect(blockingCustomerVisibleTextIssues(payload)).toEqual([]);
  });

  it('detects duplicate destination tokens and cross-field duplicate phrases', () => {
    const issues = auditCustomerVisibleProductText({
      title: '다낭 다낭 특가 패키지',
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

  it('does not audit internal ids as customer-visible text', () => {
    const issues = auditCustomerVisibleProductText({
      title: '푸꾸옥 노옵션 핵심관광 3박5일',
      internal_code: 'PUS-ETC-PQC-05-0001',
      itinerary_data: {
        days: [
          {
            schedule: [
              {
                activity: '사오비치 관광',
                attraction_ids: ['8ccb7e3f-bbd8-41d7-9c97-ef283e399820'],
                entity_kind: 'attraction',
              },
            ],
          },
        ],
      },
    });

    expect(issues.map(issue => issue.fieldPath)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('attraction_ids'),
        expect.stringContaining('internal_code'),
      ]),
    );
  });

  it('audits actual screen text by line and surface', () => {
    const issues = auditCustomerVisibleScreenText([
      '다낭 다낭 베스트 상품',
      '바나힐 방문합니다',
      '특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔',
      '유류할증료(6월 기준)',
    ].join('\n'), { surface: 'lp' });

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_destination_token',
      'low_information_action_sentence',
      'supplier_notation',
    ]));
    expect(issues.every(issue => issue.surface === 'lp')).toBe(true);
  });
});
