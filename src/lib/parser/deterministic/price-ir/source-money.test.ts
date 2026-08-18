import { describe, expect, it } from 'vitest';

import {
  extractSourceWonAmounts,
  parseSourceWonAmount,
  sourceWonEvidenceContainsAmount,
} from './source-money';

describe('supplier source KRW normalization', () => {
  it.each([
    ['899,', 899_000, 1000],
    ['699,---', 699_000, 1000],
    ['999,-', 999_000, 1000],
    ['1,079,-', 1_079_000, 1000],
    ['839.000', 839_000, 1],
    ['839,000원', 839_000, 1],
  ])('normalizes %s without mutating its evidence', (raw, amount, scale) => {
    expect(parseSourceWonAmount(raw, { allowBareSaleShorthand: true })).toMatchObject({
      amount,
      raw,
      sourceAmountScale: scale,
    });
  });

  it('accepts a bare amount only inside an explicit sale context', () => {
    expect(parseSourceWonAmount('399')).toBeNull();
    expect(extractSourceWonAmounts('399 특가', { allowBareSaleShorthand: true }))
      .toEqual([expect.objectContaining({ amount: 399_000, notation: 'bare_sale_shorthand' })]);
    expect(extractSourceWonAmounts('2026년 8월 특가', { allowBareSaleShorthand: true })).toEqual([]);
  });

  it('preserves both list and final amounts for the commercial resolver', () => {
    expect(extractSourceWonAmounts('839,000 -> 599,000'))
      .toEqual([
        expect.objectContaining({ amount: 839_000 }),
        expect.objectContaining({ amount: 599_000 }),
      ]);
  });

  it('accepts HWP exports that render the won sign as a backslash', () => {
    expect(extractSourceWonAmounts('예상판매가격 \\1,499,000')).toEqual([
      expect.objectContaining({ amount: 1_499_000 }),
    ]);
    expect(sourceWonEvidenceContainsAmount('\\1,499,000', 1_499_000)).toBe(true);
  });

  it('does not treat a comma-separated departure day as a bare special price', () => {
    expect(extractSourceWonAmounts('\u2665\uD2B9\uAC00\u2665 8/24, 31', { allowBareSaleShorthand: true })).toEqual([]);
  });

  it('does not convert a dollar amount into a bare KRW special price', () => {
    expect(extractSourceWonAmounts('특가상품 옵션 $100/인', { allowBareSaleShorthand: true })).toEqual([]);
    expect(extractSourceWonAmounts('1인 패널티 $300', { allowBareSaleShorthand: true })).toEqual([]);
  });

  it.each([
    '바위 3,400여개의 비경',
    '수용 인원 30,000명',
    '전장 120,000m',
    '전체 50,000석 규모',
  ])('수량과 측정치 %s를 상품가로 해석하지 않는다', source => {
    expect(extractSourceWonAmounts(source)).toEqual([]);
  });

  it('replays normalized values directly from the original quote', () => {
    expect(sourceWonEvidenceContainsAmount('10/1\n899,', 899_000)).toBe(true);
    expect(sourceWonEvidenceContainsAmount('399 특가', 399_000)).toBe(true);
    expect(sourceWonEvidenceContainsAmount('839.000', 839_000)).toBe(true);
  });
});
