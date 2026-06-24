import { describe, expect, it } from 'vitest';

import { buildCustomerSourceRawText } from './source-evidence-raw-text';

describe('buildCustomerSourceRawText', () => {
  it('appends a bounded shared price-table excerpt when split product raw text lost common price evidence', () => {
    const result = buildCustomerSourceRawText({
      productRawText: '부산-계림 고품격\n출발날짜 26년 9월 23일 ~ 11월 26일 : 매주 (수, 목) 출발',
      documentRawText: [
        '부산-계림 실속 품격 고품격',
        '출발날짜 26년 9월 23일 ~ 11월 26일 : 매주 (수, 목) 출발',
        '고품격 1,269,000',
      ].join('\n'),
      priceDates: [{ date: '2026-09-30', price: 1269000 }],
    });

    expect(result.appendedSharedEvidence).toBe(true);
    expect(result.rawText).toContain('[공통 가격표 원문 근거]');
    expect(result.rawText).toContain('1,269,000');
    expect(result.rawTextHash).toHaveLength(64);
  });

  it('does not append duplicate evidence when the product raw text already supports the saved price', () => {
    const result = buildCustomerSourceRawText({
      productRawText: '출발일 9/30\n상품가 1,269,000',
      documentRawText: '출발일 9/30\n상품가 1,269,000',
      priceDates: [{ date: '2026-09-30', price: 1269000 }],
    });

    expect(result.appendedSharedEvidence).toBe(false);
    expect(result.rawText).not.toContain('[공통 가격표 원문 근거]');
  });
});
