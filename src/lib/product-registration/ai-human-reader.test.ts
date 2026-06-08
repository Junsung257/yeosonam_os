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

  it('recognizes compact supplier date lines followed by one price line', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        'PKG',
        '7/4,18 8/22(토)',
        '1,049,000원',
        '*선착순 10석, 6/10선발',
      ].join('\n'),
      durationDays: 6,
      year: 2026,
    });

    expect(result.pricePairs.map(row => `${row.date}:${row.adult_price}`)).toEqual(
      expect.arrayContaining([
        '2026-07-04:1049000',
        '2026-07-18:1049000',
        '2026-08-22:1049000',
      ]),
    );
  });

  it('keeps multiple adjacent price columns as source evidence for the same departure date', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '6/1 월 3박',
        '999,000',
        '1,229,000',
        '1,359,000',
        '1,439,000',
      ].join('\n'),
      durationDays: 4,
      year: 2026,
    });

    const prices = result.pricePairs
      .filter(row => row.date === '2026-06-01')
      .map(row => row.adult_price)
      .sort((a, b) => a - b);

    expect(prices).toEqual([999000, 1229000, 1359000, 1439000]);
  });

  it('reads monthly Korean weekday grids into date-scoped source-backed prices', () => {
    const result = readSupplierDocumentLikeHuman({
      rawText: [
        '6월',
        '1~20',
        '월',
        '3박4일',
        '759,000',
        '999,000',
        '1,179,000',
        '1,229,000',
        '화',
        '수',
        '829,000',
        '1,059,000',
        '1,259,000',
        '1,299,000',
        '목',
        '949,000',
        '1,199,000',
        '1,359,000',
        '1,399,000',
        '금',
        '899,000',
        '1,129,000',
        '1,319,000',
        '1,359,000',
        '토',
        '849,000',
        '1,069,000',
        '1,259,000',
        '1,299,000',
        '일',
      ].join('\n'),
      durationDays: 4,
      year: 2026,
    });

    const prices = result.pricePairs
      .filter(row => row.date === '2026-06-20')
      .map(row => row.adult_price)
      .sort((a, b) => a - b);

    expect(prices).toEqual([849000, 1069000, 1259000, 1299000]);
  });
});
