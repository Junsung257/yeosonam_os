import { describe, expect, it } from 'vitest';
import {
  buildDefaultOcrBenchmarkInput,
  OCR_BENCHMARK_CANDIDATE_ENGINES,
  runProductOcrBenchmark,
  sha256OcrBenchmarkText,
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
    expect(report.summary.productSplitPreserved).toBe(report.total);
    expect(report.summary.priceRowsPreserved).toBe(report.total);
    expect(report.summary.priceDatesPreserved).toBe(report.total);
    expect(report.summary.itineraryDayRowsPreserved).toBe(report.total);
    expect(report.summary.flightSeparated).toBe(report.total);
    expect(report.summary.hotelSeparated).toBe(report.total);
    expect(report.summary.mealSeparated).toBe(report.total);
    expect(report.summary.evidenceSpanRecoverable).toBe(report.total);
    expect(report.summary.finalCustomerOutcomeReady).toBe(report.total);
    expect(report.engines).toEqual([expect.objectContaining({
      engine: 'text-upload-baseline',
      versions: ['supplier-raw-golden-v1'],
      failed: 0,
    })]);
    expect(report.results.every(result => result.provenance.extractedTextSha256.length === 64)).toBe(true);
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

  it('requires reproducible provenance for external OCR engines', async () => {
    const baseline = buildDefaultOcrBenchmarkInput().candidates[0]!;
    const report = await runProductOcrBenchmark({
      candidates: [{
        ...baseline,
        engine: 'docling',
        engineVersion: null,
        sourceFile: 'C:\\private\\supplier.pdf',
        sourceSha256: null,
        extractedTextSha256: '0'.repeat(64),
        durationMs: -1,
      }],
    });

    expect(report.failed).toBe(1);
    expect(report.results[0]?.sourceFile).toBe('supplier.pdf');
    expect(report.results[0]?.failures).toEqual(expect.arrayContaining([
      'engine_version_missing',
      'source_sha256_invalid',
      'extracted_text_sha256_mismatch',
      'duration_ms_invalid',
    ]));
  });

  it('accepts a fully pinned shadow extraction and reports it by engine', async () => {
    const baseline = buildDefaultOcrBenchmarkInput().candidates[0]!;
    const extractedTextSha256 = sha256OcrBenchmarkText(baseline.extractedText);
    const report = await runProductOcrBenchmark({
      candidates: [{
        ...baseline,
        engine: 'paddleocr-pp-structure-v3',
        engineVersion: '3.3.2',
        sourceFile: 'supplier.pdf',
        sourceSha256: 'a'.repeat(64),
        extractedTextSha256,
        durationMs: 1234,
      }],
    });

    expect(report).toMatchObject({ passed: 1, failed: 0 });
    expect(report.engines).toEqual([expect.objectContaining({
      engine: 'paddleocr-pp-structure-v3',
      versions: ['3.3.2'],
      passed: 1,
    })]);
    expect(report.results[0]?.provenance).toMatchObject({
      sourceSha256: 'a'.repeat(64),
      extractedTextSha256,
      durationMs: 1234,
    });
  });

  it('fails duplicate engine/case/source identities closed', async () => {
    const baseline = buildDefaultOcrBenchmarkInput().candidates[0]!;
    const report = await runProductOcrBenchmark({ candidates: [baseline, { ...baseline }] });

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.results[1]?.failures).toContain('duplicate_candidate_identity');
  });
});
