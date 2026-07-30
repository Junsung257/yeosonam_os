import { describe, expect, it } from 'vitest';
import {
  applySourceDeclaredSalesExclusions,
  applyUnpricedDateSalesQuarantine,
  extractSourceDeclaredSalesExclusions,
  extractUnpricedDateSalesQuarantines,
} from './date-sales-quarantine';

const SHIZUOKA_HOLIDAY_LINE =
  '일본공휴일 7/18 ~20, 8/11, 8/14, 9/19~9/27, 10/9~12, 11/3, 11/21~23 기간은 일본연휴기간으로 지상비 추가';

describe('date sales quarantine', () => {
  it('parses every exact Shizuoka holiday range without inventing a surcharge amount', () => {
    const result = extractUnpricedDateSalesQuarantines(SHIZUOKA_HOLIDAY_LINE, 2026);

    expect(result).toHaveLength(1);
    expect(result[0].dateTokens).toEqual([
      '7/18~7/20',
      '8/11',
      '8/14',
      '9/19~9/27',
      '10/9~10/12',
      '11/3',
      '11/21~11/23',
    ]);
    expect(result[0].dates).toHaveLength(22);
    expect(result[0].dates).toContain('2026-07-18');
    expect(result[0].dates).toContain('2026-11-23');
  });

  it('does not quarantine when the source line states an exact ground-cost amount', () => {
    const result = extractUnpricedDateSalesQuarantines(
      `${SHIZUOKA_HOLIDAY_LINE} 1인 50,000원`,
      2026,
    );

    expect(result).toEqual([]);
  });

  it('does not infer a calendar year when neither source nor recovered prices establish one', () => {
    const result = extractUnpricedDateSalesQuarantines(
      SHIZUOKA_HOLIDAY_LINE,
      undefined,
    );

    expect(result).toEqual([]);
  });

  it('parses carry-forward month notation in source-declared flight exclusion dates', () => {
    const result = extractSourceDeclaredSalesExclusions(
      '항공제외일 – 7/17,26~30 8/2,3,5,6,15,16,18',
      2026,
    );

    expect(result).toHaveLength(1);
    expect(result[0].dates).toHaveLength(13);
    expect(result[0].dates).toContain('2026-07-17');
    expect(result[0].dates).toContain('2026-07-30');
    expect(result[0].dates).toContain('2026-08-03');
    expect(result[0].dates).toContain('2026-08-18');
  });

  it('removes source-declared flight exclusion dates before customer sale', () => {
    const result = applySourceDeclaredSalesExclusions({
      rawText: '항공제외일 – 7/17,26~30 8/2,3,5,6,15,16,18',
      year: 2026,
      tiers: [{
        period_label: '금요일',
        departure_dates: ['2026-07-10', '2026-07-17', '2026-07-24'],
        departure_day_of_week: '금',
        date_range: { start: '2026-07-01', end: '2026-07-31' },
        adult_price: 1_519_000,
        status: 'available',
      }],
      priceRows: [
        {
          target_date: '2026-07-10',
          day_of_week: null,
          net_price: 1_519_000,
          adult_selling_price: 1_519_000,
          child_price: null,
          note: null,
        },
        {
          target_date: '2026-07-17',
          day_of_week: null,
          net_price: 1_519_000,
          adult_selling_price: 1_519_000,
          child_price: null,
          note: null,
        },
        {
          target_date: '2026-07-24',
          day_of_week: null,
          net_price: 1_519_000,
          adult_selling_price: 1_519_000,
          child_price: null,
          note: null,
        },
      ],
      priceDates: [
        { date: '2026-07-10', price: 1_519_000, confirmed: false },
        { date: '2026-07-17', price: 1_519_000, confirmed: false },
        { date: '2026-07-24', price: 1_519_000, confirmed: false },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.removedPriceDates).toEqual(['2026-07-17']);
    expect(result.priceDates.map(row => row.date)).toEqual([
      '2026-07-10',
      '2026-07-24',
    ]);
    expect(result.tiers[0].excluded_dates).toContain('2026-07-17');
  });

  it('removes risky dates from product_prices, price_dates, and tier departure dates', () => {
    const result = applyUnpricedDateSalesQuarantine({
      rawText: SHIZUOKA_HOLIDAY_LINE,
      year: 2026,
      tiers: [{
        period_label: '7/6~7/29 월/수',
        departure_dates: ['2026-07-15', '2026-07-20', '2026-07-22'],
        departure_day_of_week: '월',
        date_range: { start: '2026-07-06', end: '2026-07-29' },
        adult_price: 1_079_000,
        status: 'available',
      }],
      priceRows: [
        {
          target_date: '2026-07-15',
          day_of_week: null,
          net_price: 1_079_000,
          adult_selling_price: 1_079_000,
          child_price: null,
          note: null,
        },
        {
          target_date: '2026-07-20',
          day_of_week: null,
          net_price: 1_079_000,
          adult_selling_price: 1_079_000,
          child_price: null,
          note: null,
        },
        {
          target_date: '2026-07-22',
          day_of_week: null,
          net_price: 1_079_000,
          adult_selling_price: 1_079_000,
          child_price: null,
          note: null,
        },
      ],
      priceDates: [
        { date: '2026-07-15', price: 1_079_000, confirmed: false },
        { date: '2026-07-20', price: 1_079_000, confirmed: false },
        { date: '2026-07-22', price: 1_079_000, confirmed: false },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.removedPriceDates).toEqual(['2026-07-20']);
    expect(result.priceDates.map(row => row.date)).toEqual([
      '2026-07-15',
      '2026-07-22',
    ]);
    expect(result.priceRows.map(row => row.target_date)).toEqual([
      '2026-07-15',
      '2026-07-22',
    ]);
    expect(result.tiers[0].departure_dates).toEqual([
      '2026-07-15',
      '2026-07-22',
    ]);
    expect(result.tiers[0].excluded_dates).toContain('2026-07-20');
  });

  it('fails closed when all recovered sale dates fall inside the quarantine', () => {
    const result = applyUnpricedDateSalesQuarantine({
      rawText: SHIZUOKA_HOLIDAY_LINE,
      year: 2026,
      tiers: [{
        period_label: '휴일',
        departure_dates: ['2026-07-20'],
        departure_day_of_week: '월',
        adult_price: 1_079_000,
        status: 'available',
      }],
      priceRows: [{
        target_date: '2026-07-20',
        day_of_week: null,
        net_price: 1_079_000,
        adult_selling_price: 1_079_000,
        child_price: null,
        note: null,
      }],
      priceDates: [{
        date: '2026-07-20',
        price: 1_079_000,
        confirmed: false,
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.failure).toContain('removed every');
  });

  it('fails closed for recurring weekday price rows that cannot prove date exclusion', () => {
    const result = applyUnpricedDateSalesQuarantine({
      rawText: SHIZUOKA_HOLIDAY_LINE,
      year: 2026,
      tiers: [],
      priceRows: [{
        target_date: null,
        day_of_week: 'MON',
        net_price: 1_079_000,
        adult_selling_price: 1_079_000,
        child_price: null,
        note: null,
      }],
      priceDates: [{
        date: '2026-07-20',
        price: 1_079_000,
        confirmed: false,
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.failure).toContain('undated weekday');
  });
});
