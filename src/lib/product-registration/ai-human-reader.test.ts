import { describe, expect, it } from 'vitest';
import { readSupplierDocumentLikeHuman } from './ai-human-reader';

const RAW_PRICE_TABLE = `
[Kyushu Fukuoka 2N3D]
상품가
7/1, 6, 8, 13, 15
1,299,000원
7/20, 22, 27, 29
1,399,000원
8/3, 5
1,499,000원
포함 내역
항공권
`;

describe('readSupplierDocumentLikeHuman', () => {
  it('keeps source-backed price/date pairs with evidence spans', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: RAW_PRICE_TABLE,
      title: 'Kyushu Fukuoka 2N3D',
      durationDays: 3,
      year: 2026,
    });

    expect(result.source).toBe('deterministic_evidence_reader');
    expect(result.priceSource).toBe('product_price_vertical_date_table');
    expect(result.pricePairs.length).toBeGreaterThanOrEqual(11);
    expect(result.pricePairs.find(row => row.date === '2026-07-01')?.adult_price).toBe(1299000);
    expect(result.evidenceSpans.some(span => span.field === 'human_reader.price_pair')).toBe(true);
    expect(result.uncertainties).not.toContain('no source-backed product price/date pairs recognized by evidence reader');
  });
});
