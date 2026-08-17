import { describe, expect, it } from 'vitest';

import { extractPriceIR } from './index';

describe('explicit date weekday price relation', () => {
  it('extracts one Korean month-day-weekday selling price on the same line', () => {
    const result = extractPriceIR([
      '황산,휘주고성 3박4일【화】',
      '취항특가 8명 선착순 마감!! (팁포함)',
      '4월 14일 (화) 399,000원',
      '최소출발 8명',
    ].join('\n'), { year: 2026 });

    expect(result.source).toBe('explicit_date_weekday_price');
    expect(result.rows).toEqual([expect.objectContaining({
      date: '2026-04-14',
      weekday: 2,
      adult_price: 399000,
      price_relation: 'standard_sale',
    })]);
  });

  it('does not treat fees or ambiguous multiple amounts as a simple selling-price row', () => {
    expect(extractPriceIR([
      '4월 14일 (화) 싱글차지 399,000원',
      '4월 14일 (화) 499,000원 → 399,000원',
    ].join('\n'), { year: 2026 }).rows).toEqual([]);
  });

  it('pairs one explicit Korean departure date with one nearby product price in the header', () => {
    const result = extractPriceIR([
      '\uBD80\uC0B0\uCD9C\uBC1C \uD669\uC0B0 3\uBC154\uC77C',
      '26\uB144 04\uC6D4 14\uC77C (\uD654) \uCD9C\uBC1C',
      '\uCD9C\uBC1C\uB0A0\uC9DC',
      '\uC131\uC778 8\uBA85 \uC774\uC0C1',
      '\\699,000 [\uC120\uCC29\uC21C 8\uBA85]',
      '\uC0C1 \uD488 \uAC00',
      '\uD3EC \uD568',
      '\uC655\uBCF5\uD56D\uACF5\uB8CC, \uD638\uD154, \uC2DD\uC0AC',
    ].join('\n'), { year: 2026 });

    expect(result.source).toBe('explicit_date_weekday_price');
    expect(result.rows).toEqual([expect.objectContaining({
      date: '2026-04-14',
      weekday: 2,
      adult_price: 699_000,
    })]);
  });

  it('fails closed when a header has competing selling prices', () => {
    const result = extractPriceIR([
      '26\uB144 09\uC6D4 14\uC77C (\uC6D4) \uCD9C\uBC1C',
      '699,000\uC6D0',
      '799,000\uC6D0',
      '\uC0C1\uD488\uAC00',
      '\uD3EC\uD568',
    ].join('\n'), { year: 2026 });

    expect(result.rows).toEqual([]);
  });

  it('does not turn a surcharge departure range into the product departure date', () => {
    const result = extractPriceIR([
      '\uCD9C\uBC1C\uC77C',
      '1\uC778 \uC0C1\uD488\uAC00',
      '7/1',
      '959,000\uC6D0',
      '\u25CF \uC36C\uCC28\uC9C0 7\uC6D41\uC77C \uCD9C\uBC1C~8\uC6D430\uC77C \uCD9C\uBC1C 1\uC778 5\uB9CC\uC6D0 \uCD94\uAC00',
      '6\uC6D47\uC77C-6\uC6D430\uC77C 1,199,000\uC6D0',
      '7\uC6D41\uC77C-7\uC6D424\uC77C 1,249,000\uC6D0',
    ].join('\n'), { year: 2026 });

    expect(result.source).not.toBe('explicit_date_weekday_price');
  });

  it('maps each listed departure date to its one matching weekday price', () => {
    const result = extractPriceIR([
      '나트랑 달랏 3박5일',
      '9/26,27,28,29,30 중 출발기준',
      '수목금出 – 619,000원',
      '토일월화出 – 579,000원',
      '제1일 부산 출발',
    ].join('\n'), { year: 2026 });

    expect(result.source).toBe('explicit_date_weekday_price');
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-09-26', adult_price: 579_000 }),
      expect.objectContaining({ date: '2026-09-27', adult_price: 579_000 }),
      expect.objectContaining({ date: '2026-09-28', adult_price: 579_000 }),
      expect.objectContaining({ date: '2026-09-29', adult_price: 579_000 }),
      expect.objectContaining({ date: '2026-09-30', adult_price: 619_000 }),
    ]);
  });

  it('fails closed when two weekday rules overlap for a listed departure', () => {
    const result = extractPriceIR([
      '9/26,27 중 출발기준',
      '토일出 – 619,000원',
      '토出 – 579,000원',
    ].join('\n'), { year: 2026 });
    expect(result.source).toBe('none');
    expect(result.rows).toEqual([]);
  });
});
