import { describe, expect, it } from 'vitest';

import { extractPriceIR, parseFinalSalePriceFromLine } from './index';

describe('commercial price relation', () => {
  it('uses the amount after an explicit discount arrow as the final sale price', () => {
    expect(parseFinalSalePriceFromLine('1인 1,199,000원→1,039,000원')).toEqual({
      finalSalePrice: 1_039_000,
      listPrice: 1_199_000,
      minTravelers: null,
      maxTravelers: null,
      relation: 'final_sale',
    });
  });

  it('recognizes the supplier triangle arrow without requiring a duplicated price label', () => {
    expect(parseFinalSalePriceFromLine('739,000원 ▶699,000원')).toEqual({
      finalSalePrice: 699_000,
      listPrice: 739_000,
      minTravelers: null,
      maxTravelers: null,
      relation: 'final_sale',
    });
  });

  it('normalizes arrow prices without a won suffix and keeps the final amount', () => {
    expect(parseFinalSalePriceFromLine('839,000 -> 599,000')).toEqual({
      finalSalePrice: 599_000,
      listPrice: 839_000,
      minTravelers: null,
      maxTravelers: null,
      relation: 'final_sale',
    });
  });

  it('keeps one final package price when the source says adults and children pay the same', () => {
    expect(parseFinalSalePriceFromLine('￦699,000원 => 579,000/인 [*성인/아동 동일]')).toEqual({
      finalSalePrice: 579_000,
      listPrice: 699_000,
      minTravelers: null,
      maxTravelers: null,
      relation: 'final_sale',
    });
  });

  it('normalizes supplier thousand shorthand and a bare special price', () => {
    expect(parseFinalSalePriceFromLine('1인 특가 899,')).toEqual(expect.objectContaining({
      finalSalePrice: 899_000,
    }));
    expect(parseFinalSalePriceFromLine('399 특가')).toEqual(expect.objectContaining({
      finalSalePrice: 399_000,
    }));
  });

  it.each([
    '노쇼핑 진행시 노쇼핑 차지 1인 80불 비용 발생',
    '12/31 갈라디너 1인 150불 발생',
  ])('does not convert a foreign-currency or surcharge line into a KRW package price: %s', line => {
    expect(parseFinalSalePriceFromLine(line)).toBeNull();
  });

  it('never treats commission as a selling price', () => {
    expect(parseFinalSalePriceFromLine('12% COMM 1,199,000원')).toBeNull();
    expect(parseFinalSalePriceFromLine('커미션 100,000원')).toBeNull();
  });

  it('binds an evidence-local departure date to the final arrow price', () => {
    const result = extractPriceIR([
      '출발일 2026-09-27',
      '1인 1,199,000원 → 1,039,000원',
      '제1일 공항 집결',
    ].join('\n'), { year: 2026 });
    expect(result.source).toBe('commercial_price_relation');
    expect(result.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-27',
        adult_price: 1_039_000,
        list_price: 1_199_000,
        price_relation: 'final_sale',
      }),
    ]);
  });

  it('does not merge the month of a following date into the first month', () => {
    const result = extractPriceIR('8/30, 9/13 出 - 1인 799,000 → 599,000', { year: 2026 });
    expect(result.rows.map(row => row.date)).toEqual(['2026-08-30', '2026-09-13']);
    expect(result.rows.every(row => row.adult_price === 599_000 && row.list_price === 799_000)).toBe(true);
  });

  it('preserves party-size scope instead of averaging tier prices', () => {
    const result = extractPriceIR('출발일 2026-10-10\n성인 10~14명 899,000원', { year: 2026 });
    expect(result.rows[0]).toEqual(expect.objectContaining({
      adult_price: 899_000,
      min_travelers: 10,
      max_travelers: 14,
    }));
  });

  it('preserves Korean 인 이상 departure tiers and ignores a parenthetical discount description', () => {
    expect(parseFinalSalePriceFromLine('📌 7인 이상 출발 시 : 1,790,000원(10만원 추가 할인)')).toEqual({
      finalSalePrice: 1_790_000,
      listPrice: null,
      minTravelers: 7,
      maxTravelers: null,
      relation: 'standard_sale',
    });
    expect(parseFinalSalePriceFromLine('📌 10인 이상 출발 시 : 1,690,000원(20만원 추가 할인)')).toEqual({
      finalSalePrice: 1_690_000,
      listPrice: null,
      minTravelers: 10,
      maxTravelers: null,
      relation: 'standard_sale',
    });
  });

  it('does not choose an arbitrary amount when a line has multiple unlabeled prices', () => {
    expect(parseFinalSalePriceFromLine('상품가 899,000원 / 999,000원')).toBeNull();
  });
});
