import { describe, expect, it } from 'vitest';

import {
  benchmarkAnnotationHash,
  compareCanonicalSectionToGroundTruth,
  compareCanonicalSectionSequenceToGroundTruth,
  resolveReviewedBenchmarkAnnotation,
  type ReviewedBenchmarkAnnotation,
} from './benchmark-ground-truth';

const annotation: ReviewedBenchmarkAnnotation = {
  sections: [{
    title: '\uBD80\uC0B0 \uB2E4\uB0AD 3\uBC155\uC77C',
    sourceSalePricePresent: true,
    departurePrices: [{ date: '2026-09-01', amount: 699000, currency: 'KRW' }],
    dayCounts: [5],
    flights: [{ code: 'BX321', departureAirport: 'PUS', arrivalAirport: 'DAD', departureTime: '19:00', arrivalTime: '22:00' }],
    hotels: ['\uB2E4\uB0AD \uD638\uD154 \uB610\uB294 \uB3D9\uAE09'],
    inclusions: ['\uC655\uBCF5\uD56D\uACF5\uB8CC'],
    exclusions: ['\uAC1C\uC778\uACBD\uBE44'],
    cancellationPresent: true,
  }],
};

function section() {
  return {
    titleHint: '\uBD80\uC0B0 \uB2E4\uB0AD 3\uBC155\uC77C',
    v3: { ledger: { variants: [{
      title_parts: ['\uBD80\uC0B0 \uB2E4\uB0AD 3\uBC155\uC77C'],
      price_calendar: [{ date: '2026-09-01', amount: 699000, currency: 'KRW' }],
      days: Array.from({ length: 5 }, (_, index) => ({ day: index + 1, hotel: index === 0 ? { raw_text: '\uB2E4\uB0AD \uD638\uD154 \uB610\uB294 \uB3D9\uAE09' } : {} })),
      flight_segments: [{ code: 'BX321', dep_airport: 'PUS', arr_airport: 'DAD', dep_time: '19:00', arr_time: '22:00' }],
      inclusions: [{ value: '\uC655\uBCF5\uD56D\uACF5\uB8CC' }],
      exclusions: [{ value: '\uAC1C\uC778\uACBD\uBE44' }],
    }] } },
  };
}

describe('reviewed product-registration benchmark ground truth', () => {
  it('accepts only blinded reviews whose content hashes agree', () => {
    const hash = benchmarkAnnotationHash(annotation);
    expect(resolveReviewedBenchmarkAnnotation({
      first: { annotation, annotationHash: hash, blindedToEngine: true },
      second: { annotation, annotationHash: hash, blindedToEngine: true },
    }).annotation).toEqual(annotation);
    expect(() => resolveReviewedBenchmarkAnnotation({
      first: { annotation, annotationHash: '0'.repeat(64), blindedToEngine: true },
      second: { annotation, annotationHash: hash, blindedToEngine: true },
    })).toThrow('BENCHMARK_REVIEW_HASH_MISMATCH:first');
  });

  it('requires an independent sale-price-present decision for every reviewed section', () => {
    const missingDecision = {
      ...annotation,
      sections: annotation.sections.map(({ sourceSalePricePresent: _sourceSalePricePresent, ...section }) => section),
    } as unknown as ReviewedBenchmarkAnnotation;
    const hash = benchmarkAnnotationHash(missingDecision);
    expect(() => resolveReviewedBenchmarkAnnotation({
      first: { annotation: missingDecision, annotationHash: hash, blindedToEngine: true },
      second: { annotation: missingDecision, annotationHash: hash, blindedToEngine: true },
    })).toThrow('BENCHMARK_SOURCE_SALE_PRICE_REVIEW_REQUIRED:first:0');
  });

  it('accepts a reviewed upload year only when every annotated departure agrees', () => {
    const assisted: ReviewedBenchmarkAnnotation = { ...annotation, sourceDepartureYear: 2026 };
    const hash = benchmarkAnnotationHash(assisted);
    expect(resolveReviewedBenchmarkAnnotation({
      first: { annotation: assisted, annotationHash: hash, blindedToEngine: true },
      second: { annotation: assisted, annotationHash: hash, blindedToEngine: true },
    }).annotation.sourceDepartureYear).toBe(2026);

    const conflicting: ReviewedBenchmarkAnnotation = { ...annotation, sourceDepartureYear: 2027 };
    const conflictingHash = benchmarkAnnotationHash(conflicting);
    expect(() => resolveReviewedBenchmarkAnnotation({
      first: { annotation: conflicting, annotationHash: conflictingHash, blindedToEngine: true },
      second: { annotation: conflicting, annotationHash: conflictingHash, blindedToEngine: true },
    })).toThrow('BENCHMARK_SOURCE_DEPARTURE_YEAR_CONFLICT:first');
  });

  it('reports a source-backed exact match without a false publication', () => {
    const result = compareCanonicalSectionToGroundTruth({
      rawSection: section(),
      sourceText: '\uCDE8\uC18C \uC2DC \uD2B9\uBCC4\uC57D\uAD00\uC774 \uC801\uC6A9\uB429\uB2C8\uB2E4.',
      groundTruth: annotation.sections[0]!,
      predictedOutcome: 'verified',
    });
    expect(result.criticalExactCount).toBe(result.criticalFieldCount);
    expect(result.criticalFalsePublish).toBe(false);
    expect(result.fieldDiffs).toEqual([]);
  });

  it('treats a wrong exposed price as critical even for degraded publication', () => {
    const rawSection = section();
    (rawSection.v3.ledger.variants[0]!.price_calendar[0] as { amount: number }).amount = 799000;
    const result = compareCanonicalSectionToGroundTruth({
      rawSection,
      sourceText: '\uCDE8\uC18C \uC2DC \uD2B9\uBCC4\uC57D\uAD00\uC774 \uC801\uC6A9\uB429\uB2C8\uB2E4.',
      groundTruth: annotation.sections[0]!,
      predictedOutcome: 'degraded',
    });
    expect(result.criticalFalsePublish).toBe(true);
    expect(result.fieldDiffs).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'departure_prices' })]));
  });

  it('does not accept section count alone as an exact product boundary', () => {
    const result = compareCanonicalSectionSequenceToGroundTruth({
      canonicalSections: [{
        index: 0,
        sectionKey: 'source:0',
        titleHint: '다낭',
        rawText: '다낭 상품',
        rawTextHash: 'a'.repeat(64),
        sourceNodeIds: ['node-a'],
        evidence: [{ nodeId: 'node-a', quoteHash: 'b'.repeat(64), quote: '다낭 상품' }],
      }],
      groundTruthSections: [{
        ...annotation.sections[0]!,
        boundary: {
          startAnchor: { anchorId: 'node-wrong', quoteHash: 'b'.repeat(64) },
          endAnchor: { anchorId: 'node-wrong', quoteHash: 'b'.repeat(64) },
          rawTextHash: 'a'.repeat(64),
        },
      }],
    });
    expect(result.exact).toBe(false);
    expect(result.diffs).toContain('SECTION_START_ANCHOR:0');
  });

  it('requires product identity, evidence boundaries and a typed sale component in V2', () => {
    const v2: ReviewedBenchmarkAnnotation = {
      schemaVersion: 'product-registration-reviewed-benchmark-2',
      referenceDate: '2026-08-16',
      expectedDocumentClass: 'travel_product',
      sections: [{
        ...annotation.sections[0]!,
        boundary: {
          startAnchor: { anchorId: 'node-a', quoteHash: 'a'.repeat(64) },
          endAnchor: { anchorId: 'node-z', quoteHash: 'c'.repeat(64) },
        },
        productIdentity: {
          destination: '다낭', durationDays: 5, nights: 3, hotelMode: 'unconfirmed', hotels: ['다낭 호텔 또는 동급'], flightCodes: ['BX321'],
        },
        priceComponents: [],
        cancellationCoverage: 'source',
      }],
    };
    const review = { annotation: v2, annotationHash: benchmarkAnnotationHash(v2), blindedToEngine: true as const };
    expect(() => resolveReviewedBenchmarkAnnotation({ first: review, second: review }))
      .toThrow('SALE_PRICE_FACT_REQUIRED');
  });
});
