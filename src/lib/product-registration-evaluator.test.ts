import { describe, expect, it } from 'vitest';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from './product-registration-golden-fixtures';
import { evaluateProductRegistrationCorpus } from './product-registration-evaluator';

describe('evaluateProductRegistrationCorpus', () => {
  it('turns the supplier raw golden corpus into measurable accuracy and savings gates', () => {
    const report = evaluateProductRegistrationCorpus();

    expect(report.total).toBe(SUPPLIER_RAW_GOLDEN_FIXTURES.length);
    expect(report.failed).toBe(0);
    expect(report.passRate).toBe(1);
    expect(report.deterministicSkipRate).toBe(1);
    expect(report.duplicateSecondPassSkipRate).toBe(1);
    expect(report.sectionReduceReadyRate).toBe(1);
    expect(report.sectionReusableChars).toBeGreaterThan(0);
    expect(report.scenarioCoverage.free_text_itinerary).toBeGreaterThan(0);
    expect(report.scenarioCoverage.alternate_labels).toBeGreaterThan(0);
    expect(report.scenarioCoverage.multi_departure_price).toBeGreaterThan(0);
    expect(report.scenarioCoverage.table_heavy_price).toBeGreaterThan(0);
    expect(report.scenarioCoverage.optional_tour_heavy).toBeGreaterThan(0);
    expect(report.scenarioCoverage.ocr_noisy).toBeGreaterThan(0);
    expect(report.scenarioCoverageRate).toBe(1);
    expect(report.missingRequiredScenarios).toEqual([]);
    expect(report.fixtures.every(fixture => fixture.sectionCacheEntryCount > 0)).toBe(true);
  });

  it('reports field-level failures instead of hiding partial corpus drift', () => {
    const broken = {
      ...SUPPLIER_RAW_GOLDEN_FIXTURES[0],
      expected: {
        ...SUPPLIER_RAW_GOLDEN_FIXTURES[0].expected,
        adultPrice: 1,
      },
    };

    const report = evaluateProductRegistrationCorpus([broken]);

    expect(report.passRate).toBe(0);
    expect(report.fixtures[0].passed).toBe(false);
    expect(report.fixtures[0].failures).toContain('adultPrice');
  });
});
