import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from '@/lib/product-registration-golden-fixtures';
import { registerProductFromRaw } from '../register-product-from-raw';
import {
  evaluateGoldenCorpus,
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './evaluator';
import { CLARK_MULTIPRODUCT_EXPECTED } from './clark-multiproduct-fixture';

describe('product registration golden corpus', () => {
  it.each(GOLDEN_CORPUS_CASES)('$id remains price-date deliverable', async testCase => {
    const rawText = readGoldenText(testCase.fixture);
    const expected = readGoldenExpected(testCase.expected);
    const ed: ExtractedData = {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [],
    };

    const registration = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: ed,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });
    const recovered = registration.priceRecovery;

    expect(registration.publishable).toBe(!expected.customerDeliverableBlocked);
    expect(recovered.ok).toBe(true);
    expect(recovered.priceRows.length).toBeGreaterThan(0);
    expect(recovered.priceDates.length).toBeGreaterThanOrEqual(expected.priceDatesMinCount);
    expect(recovered.minPrice).toBe(expected.minPrice);
    expect(recovered.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
    for (const forbiddenPrice of expected.forbiddenPrices) {
      expect(recovered.priceRows.some(row => row.net_price === forbiddenPrice)).toBe(false);
      expect(recovered.priceDates.some(row => row.price === forbiddenPrice)).toBe(false);
    }

    expect(!registration.deliverability.ok).toBe(expected.customerDeliverableBlocked);
  });

  it('keeps Fukuoka price-table and cash-receipt text out of the customer itinerary/title', async () => {
    const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'fukuoka-golf-spot-weekday-cash-receipt');
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const rawText = readGoldenText(testCase.fixture);
    const expected = readGoldenExpected(testCase.expected);
    const registration = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: '현금영수증 발급 안내 드립니다',
        destination: expected.destination,
        duration: testCase.duration,
        accommodations: [...testCase.accommodations],
        rawText,
        price_tiers: [],
      },
      title: '현금영수증 발급 안내 드립니다',
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-ETC-${expected.destinationCode}-03-0010`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    const scheduleText = JSON.stringify(registration.itinerary.itineraryDataToSave?.days ?? []);

    expect(registration.identity.title).toBe(expected.title);
    expect(registration.identity.title).not.toContain('현금영수증');
    expect(registration.deliverability.ok).toBe(true);
    expect(scheduleText).not.toContain('현금영수증');
    expect(scheduleText).not.toContain('스팟특가');
    expect(scheduleText).not.toContain('월,화,수');
    expect(scheduleText).not.toMatch(/\d{1,2}\/\d{1,2}(?:~\d{1,2}\/\d{1,2})?/);
    expect(scheduleText).not.toMatch(/\d{1,3}(?:,\d{3})?,-/);
    expect(scheduleText).not.toContain('\uC720\uD6C4\uC778');
    expect(scheduleText).not.toContain('\uB3C4\uC2A4');
    expect(scheduleText).not.toContain('\uD638\uD154 \uC608\uC57D\uC2DC \uB0A0\uC9DC\uBCC4');
  });

  it('keeps corpus-level registration blockers at zero', async () => {
    const report = await evaluateGoldenCorpus();

    expect(report.total).toBe(
      GOLDEN_CORPUS_CASES.length
      + SUPPLIER_RAW_GOLDEN_FIXTURES.length
      + CLARK_MULTIPRODUCT_EXPECTED.length
    );
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.total);
    expect(report.priceRowsZeroCount).toBe(0);
    expect(report.priceDatesZeroCount).toBe(0);
    expect(report.destinationUnkCount).toBe(0);
    expect(report.optionalTourPricePollutionCount).toBe(0);
    expect(report.deliverabilityBlockedCount).toBe(0);
    expect(report.priceStorageMismatchCount).toBe(0);
    expect(report.renderBlockedCount).toBe(0);
    expect(report.minPriceMismatchCount).toBe(0);
    expect(report.specificDateMismatchCount).toBe(0);
    expect(report.priceDatesBelowExpectedCount).toBe(0);
  });
});
