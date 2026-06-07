import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from '@/lib/product-registration-golden-fixtures';
import {
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './golden-corpus/evaluator';
import { normalizeStrictFallbackPriceTiers, recoverUploadPriceData } from './price-recovery';

function phuQuocCase() {
  const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'phu-quoc-full-upload');
  if (!testCase) throw new Error('missing phu-quoc-full-upload golden case');
  const rawText = readGoldenText(testCase.fixture);
  const expected = readGoldenExpected(testCase.expected);
  return { testCase, rawText, expected };
}

describe('recoverUploadPriceData', () => {
  it('accepts only schema-valid LLM fallback price tiers with usable date evidence', () => {
    const tiers = normalizeStrictFallbackPriceTiers([
      { period_label: 'valid date', departure_dates: ['2026-07-24'], adult_price: 859000, status: 'available' },
      { period_label: 'missing date', adult_price: 859000, status: 'available' },
      { period_label: 'bad date', departure_dates: ['07/24'], adult_price: 859000, status: 'available' },
      { period_label: 'string price', departure_dates: ['2026-07-25'], adult_price: '859,000', status: 'available' },
      { period_label: 'too small', departure_dates: ['2026-07-26'], adult_price: 5000, status: 'available' },
    ]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.departure_dates).toEqual(['2026-07-24']);
    expect(tiers[0]?.adult_price).toBe(859000);
  });

  it('prefers complete deterministic IR over complete LLM tiers', async () => {
    const { testCase, rawText, expected } = phuQuocCase();
    const ed: ExtractedData = {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [{
        period_label: 'llm complete',
        departure_dates: [expected.specificDate],
        adult_price: 777000,
        status: 'available',
      }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: expected.title,
      accommodations: testCase.accommodations,
      durationDays: testCase.duration,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.priceRows.length).toBeGreaterThan(1);
    expect(result.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
  });

  it('treats price success as product_prices plus price_dates, not price_tiers alone', async () => {
    const ed: ExtractedData = {
      title: 'label only price product',
      destination: 'Phu Quoc',
      duration: 5,
      rawText: '',
      price_tiers: [{ period_label: 'Wednesday departures', departure_day_of_week: 'Wed', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: '',
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(false);
    expect(result.priceRows).toHaveLength(0);
    expect(result.priceDates).toHaveLength(0);
    expect(result.failures.some(failure => failure.startsWith('llm:price_dates'))).toBe(true);
  });

  it('recovers malformed or label-only tiers through deterministic IR', async () => {
    const { testCase, rawText, expected } = phuQuocCase();
    const ed: ExtractedData = {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [{ period_label: 'label only', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: expected.title,
      accommodations: testCase.accommodations,
      durationDays: testCase.duration,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.length).toBeGreaterThanOrEqual(expected.priceDatesMinCount);
    expect(result.minPrice).toBe(expected.minPrice);
    expect(result.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
    for (const forbiddenPrice of expected.forbiddenPrices) {
      expect(result.priceRows.some(row => row.net_price === forbiddenPrice)).toBe(false);
      expect(result.priceDates.some(row => row.price === forbiddenPrice)).toBe(false);
    }
  });

  it('recovers supplier raw free-text departure dates through the central pipeline', async () => {
    const fixture = SUPPLIER_RAW_GOLDEN_FIXTURES[0];
    const ed: ExtractedData = {
      title: fixture.expected.title,
      destination: fixture.expected.destination,
      duration: fixture.expected.dayCount,
      rawText: fixture.rawText,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: fixture.rawText,
      title: fixture.expected.title,
      durationDays: fixture.expected.dayCount,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('supplier_raw_facts');
    expect(result.minPrice).toBe(fixture.expected.adultPrice);
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.map(row => row.date)).toEqual(fixture.expected.departureDates);
    expect(result.priceDates.every(row => row.price === fixture.expected.adultPrice)).toBe(true);
  });
});
