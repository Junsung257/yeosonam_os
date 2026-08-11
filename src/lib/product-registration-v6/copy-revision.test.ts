import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV6Copy } from './copy-revision';

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
    expect(result.payload).toMatchObject({ title: '다낭 4일', policy: 'facts-template-only-v6' });
    expect(result.claimLinks).toEqual([{ claim_id: 'claim-1', copy_path: 'facts' }]);
  });
});
