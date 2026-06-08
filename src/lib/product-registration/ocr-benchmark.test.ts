import { describe, expect, it } from 'vitest';
import {
  buildDefaultOcrBenchmarkInput,
  OCR_BENCHMARK_CANDIDATE_ENGINES,
  runProductOcrBenchmark,
} from './ocr-benchmark';

describe('product OCR/PDF candidate benchmark', () => {
  it('keeps the text-upload baseline customer-ready across OCR/noisy fixtures', async () => {
    const report = await runProductOcrBenchmark();

    expect(report.total).toBe(buildDefaultOcrBenchmarkInput().candidates.length);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.total);
    expect(report.candidateEngines).toEqual(expect.arrayContaining([
      'docling',
      'marker',
      'mineru',
      'paddleocr-pp-structure-v3',
      'layoutparser',
    ] satisfies Array<typeof OCR_BENCHMARK_CANDIDATE_ENGINES[number]>));
    expect(report.summary.tableRecognitionAccuracyAvg).toBe(1);
    expect(report.summary.priceRowsPreserved).toBe(report.total);
    expect(report.summary.priceDatesPreserved).toBe(report.total);
    expect(report.summary.itineraryDayRowsPreserved).toBe(report.total);
    expect(report.summary.flightSeparated).toBe(report.total);
    expect(report.summary.hotelSeparated).toBe(report.total);
    expect(report.summary.mealSeparated).toBe(report.total);
    expect(report.summary.evidenceSpanRecoverable).toBe(report.total);
    expect(report.summary.finalCustomerOutcomeReady).toBe(report.total);
  });

  it('marks unknown benchmark cases as failed instead of guessing', async () => {
    const report = await runProductOcrBenchmark({
      candidates: [{
        engine: 'docling',
        caseId: 'missing-case',
        extractedText: '상품명: 없는 케이스',
      }],
    });

    expect(report.failed).toBe(1);
    expect(report.results[0]?.failures).toContain('unknown_case:missing-case');
    expect(report.results[0]?.metrics.finalCustomerOutcomeReady).toBe(false);
  });
});
