import { describe, expect, it } from 'vitest';

import {
  buildProductRegistrationV6Copy,
  PRODUCT_REGISTRATION_COPY_POLICY_V2,
  validateProductRegistrationCustomerCopy,
} from './copy-revision';

describe('V6 copy revision', () => {
  it('blocks high-risk sales language without verified evidence', () => {
    const result = buildProductRegistrationV6Copy({
      pkg: { title: '다낭 최저가 출발확정 상품', product_summary: '5성급 보장' },
      claims: [],
      degradedReasons: [],
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      'UNSUPPORTED_CUSTOMER_EXPRESSION:최저가',
      'UNSUPPORTED_CUSTOMER_EXPRESSION:출발확정',
      'UNSUPPORTED_CUSTOMER_EXPRESSION:보장',
      'UNSUPPORTED_CUSTOMER_EXPRESSION:5성급',
    ]));
  });

  it('keeps facts and presentation policy separate', () => {
    const result = buildProductRegistrationV6Copy({
      pkg: { title: '<b>다낭</b> 4일', product_highlights: ['시내 일정', '시내 일정'] },
      claims: [{ id: 'claim-1', field_path: 'price', normalized_value: 599000, criticality: 'critical', evidence_status: 'verified', conflict_status: 'none' }],
      degradedReasons: ['FLIGHT_TIME_NOT_CORROBORATED'],
    });
    expect(result.payload).toMatchObject({
      title: '다낭 4일',
      policy: PRODUCT_REGISTRATION_COPY_POLICY_V2,
      generation_state: 'deterministic_fallback',
    });
    expect(result.claimLinks).toEqual([{ claim_id: 'claim-1', copy_path: 'deterministic_facts.price' }]);
  });

  it('rejects cross-product locations and numbers introduced by a rewrite', () => {
    const failures = validateProductRegistrationCustomerCopy({
      copy: {
        title: '치앙마이 핵심 여행',
        summary: '다낭 원문과 무관한 7일 일정을 새로 제안하는 고객 설명입니다.',
        reasons: ['지역 핵심 일정을 비교합니다.', '포함 조건을 먼저 확인합니다.', '예약 전 최종 조건을 확인합니다.'],
        recommended_for: '일정과 조건을 비교하고 싶은 여행자에게 적합합니다.',
        important_conditions: ['예약 전에 출발 조건을 확인해 주세요.'],
        itinerary_intensity: '일정표의 이동 시간을 확인해 주세요.',
        commercial_disclosures: ['추가 비용 조건을 확인해 주세요.'],
        uncertainty_disclosure: '현재 좌석과 최종 요금은 상담 시 다시 확인합니다.',
      },
      factualText: JSON.stringify({ title: '다낭 4일', price: 599000 }),
      factualTitle: '다낭 4일',
      claims: [],
    });
    expect(failures).toEqual(expect.arrayContaining([
      'CUSTOMER_COPY_CROSS_PRODUCT_LOCATION:치앙마이',
      'CUSTOMER_COPY_NUMBER_NOT_GROUNDED:7',
      'CUSTOMER_COPY_TITLE_IDENTITY_LOST',
    ]));
  });

  it('does not send unsupported high-risk copy to a snapshot', () => {
    const result = buildProductRegistrationV6Copy({
      pkg: { title: '다낭 노쇼핑 상품', product_summary: '출발확정 상품입니다.' },
      claims: [],
      degradedReasons: [],
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      'UNSUPPORTED_CUSTOMER_EXPRESSION:노쇼핑',
      'UNSUPPORTED_CUSTOMER_EXPRESSION:출발확정',
    ]));
  });
});
