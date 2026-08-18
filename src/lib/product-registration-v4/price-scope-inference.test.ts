import { describe, expect, it } from 'vitest';

import { inferUndatedPriceScopesFromSchedule } from './price-scope-inference';

function variant(quote: string, lineStart = 2, amount = 699_000) {
  return {
    price_calendar: [{
      date: null,
      date_range: null,
      weekday: null,
      label: quote,
      amount,
      currency: 'KRW',
      evidence: {
        line_start: lineStart,
        line_end: lineStart,
        char_start: 0,
        char_end: quote.length,
        quote,
      },
    }],
  };
}

describe('inferUndatedPriceScopesFromSchedule', () => {
  it('connects a price to a unique month weekday schedule', () => {
    const target = variant('성인2+소아2 기준 - 1인 699,000원! *소아 1명일 경우 +8만', 3);
    const result = inferUndatedPriceScopesFromSchedule({
      year: 2027,
      rawText: [
        '괌 해피선데이',
        '5월 일요일 출발',
        '성인2+소아2 기준 - 1인 699,000원! *소아 1명일 경우 +8만',
      ].join('\n'),
      variants: [target],
    });

    expect(result).toEqual({ applied: 1, ambiguous: 0 });
    expect(target.price_calendar[0]).toMatchObject({
      date: null,
      date_range: { start: '2027-05-01', end: '2027-05-31' },
      weekday: 0,
    });
    expect(target.price_calendar[0]?.evidence.quote).toContain('5월 일요일 출발');
  });

  it('connects a bounded weekly schedule with a cross-month range', () => {
    const target = variant('기본가 799,000원', 2, 799_000);
    const result = inferUndatedPriceScopesFromSchedule({
      year: 2027,
      rawText: [
        '4월10일~5월29일 매주 화 출발',
        '기본가 799,000원',
      ].join('\n'),
      variants: [target],
    });

    expect(result.applied).toBe(1);
    expect(target.price_calendar[0]).toMatchObject({
      date_range: { start: '2027-04-10', end: '2027-05-29' },
      weekday: 2,
    });
  });

  it('does not guess when nearby schedules conflict', () => {
    const target = variant('판매가 699,000원', 3);
    const result = inferUndatedPriceScopesFromSchedule({
      year: 2027,
      rawText: [
        '5월 일요일 출발',
        '판매가 699,000원',
        '6월 화요일 출발',
      ].join('\n'),
      variants: [target],
    });

    expect(result).toEqual({ applied: 0, ambiguous: 1 });
    expect(target.price_calendar[0]?.date_range).toBeNull();
  });

  it('does not attach a schedule to a deposit', () => {
    const target = variant('예약금 300,000원', 2, 300_000);
    const result = inferUndatedPriceScopesFromSchedule({
      year: 2027,
      rawText: '5월 일요일 출발\n예약금 300,000원',
      variants: [target],
    });

    expect(result).toEqual({ applied: 0, ambiguous: 0 });
    expect(target.price_calendar[0]?.date_range).toBeNull();
  });
});

