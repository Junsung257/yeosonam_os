import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import {
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './golden-corpus/evaluator';
import { registerProductFromRaw } from './register-product-from-raw';

function phuQuocInput(): {
  rawText: string;
  expected: ReturnType<typeof readGoldenExpected>;
  extractedData: ExtractedData;
  duration: number;
  accommodations: string[];
} {
  const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'phu-quoc-full-upload');
  if (!testCase) throw new Error('missing phu-quoc-full-upload golden case');
  const rawText = readGoldenText(testCase.fixture);
  const expected = readGoldenExpected(testCase.expected);
  return {
    rawText,
    expected,
    duration: testCase.duration,
    accommodations: [...testCase.accommodations],
    extractedData: {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [],
    },
  };
}

describe('registerProductFromRaw', () => {
  it('registers the Phu Quoc golden upload as customer deliverable', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.publishable).toBe(true);
    expect(result.deliverability.ok).toBe(true);
    expect(result.identity.destinationCode).toBe(expected.destinationCode);
    expect(result.pricing.source).toBe('deterministic:weekday_period_table');
    expect(result.pricing.minPrice).toBe(expected.minPrice);
    expect(result.pricing.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
    expect(result.pricing.productPrices.every(row => row.adult_selling_price === row.net_price)).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('keeps Phu Quoc catalog column fragments out of schedule activities', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    const activities = result.itinerary.itineraryDataToSave?.days
      ?.flatMap(day => day.schedule?.map(item => item.activity).filter((activity): activity is string => typeof activity === 'string') ?? [])
      ?? [];

    expect(result.deliverability.ok).toBe(true);
    expect(activities).not.toEqual(expect.arrayContaining(['ZE981', '18:55', '22:25']));
    expect(result.itinerary.removedPollutedScheduleItems.length).toBeGreaterThan(0);
  });

  it('emits internal source evidence spans without requiring a DB migration', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.evidence.rawTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.spans.length).toBeGreaterThan(0);
    expect(result.evidence.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'title',
        rawTextHash: result.evidence.rawTextHash,
        productIndex: null,
        sourceKind: 'line',
      }),
    ]));
  });

  it('keeps external gate failures inside the same standard deliverability decision', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      extraFailures: ['Product Registration V2 gate failed: fixture-block'],
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.publishable).toBe(false);
    expect(result.deliverability.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('fixture-block');
  });

  it('recovers shared document price tables when the product section has no local price table', async () => {
    const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'fukuoka-golf-spot-weekday-cash-receipt');
    if (!testCase) throw new Error('missing fukuoka fixture');
    const documentRawText = readGoldenText(testCase.fixture);
    const expected = readGoldenExpected(testCase.expected);
    const sectionRawText = `
BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일
요금표참조
일자
1일차
후쿠오카 국제공항 도착
2일차
골프 18홀
3일차
후쿠오카 국제공항 출발
`;

    const result = await registerProductFromRaw({
      rawText: sectionRawText,
      documentRawText,
      extractedData: {
        title: expected.title,
        destination: expected.destination,
        duration: testCase.duration,
        rawText: sectionRawText,
        price_tiers: [],
      },
      itineraryData: {
        days: [{ day: 1 }, { day: 2 }, { day: 3 }],
      },
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-03-0001`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.pricing.source).toBe('document_raw:deterministic:spot_weekday_table');
    expect(result.pricing.productPrices.length).toBeGreaterThan(0);
    expect(result.pricing.priceDates.length).toBeGreaterThan(0);
    expect(result.publishable).toBe(true);
  });
});
