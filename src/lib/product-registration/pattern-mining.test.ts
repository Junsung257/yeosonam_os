import { describe, expect, it } from 'vitest';
import type { ImprovementLedgerEvent } from './improvement-ledger';
import { mineProductRegistrationPatterns } from './pattern-mining';

function event(index: number, overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  return {
    uploadId: `upload-${index}`,
    productId: null,
    packageId: null,
    attemptNo: 1,
    attemptPhase: 'deterministic_source_recompare',
    rawTextHash: `hash-${index}`,
    sectionRawTextHash: null,
    parserVersion: 'test',
    detectedFormat: 'catalog_pkg',
    blockersBefore: ['price storage mismatch: product_prices missing date 2026-07-24'],
    blockersAfter: [],
    normalizedBlockerSignatures: ['price storage mismatch: product_prices missing date <date>'],
    evidenceSpans: [],
    comparedFields: ['product_prices', 'price_dates'],
    autoFixesApplied: [{
      field: 'price_dates',
      kind: 'deterministic',
      reason: 'rebuild date-level minimum from product_prices',
      confidence: 0.9,
    }],
    packagesAudit: { status: 'pass', failures: [], warnings: [] },
    a4Audit: { status: 'pass', failures: [], warnings: [] },
    finalStatus: 'AUTO_FIXED',
    fixtureCandidate: false,
    ruleCandidate: true,
    createdAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('mineProductRegistrationPatterns', () => {
  it('promotes repeated successful deterministic fixes as candidates', () => {
    const report = mineProductRegistrationPatterns({
      events: [event(1), event(2), event(3)],
      minEvents: 50,
      minFailedOrReviewNeeded: 10,
      minRepeatedBlockers: 5,
    });

    expect(report.shouldRun).toBe(false);
    expect(report.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'blocker_signature',
        evidenceCount: 3,
        independentSourceCount: 3,
        promotionReady: true,
      }),
      expect.objectContaining({
        kind: 'deterministic_fix',
        signature: 'price_dates',
        autoFixSuccessRate: 1,
        promotionReady: true,
      }),
    ]));
  });

  it('does not promote repeated attempts from the same source as independent evidence', () => {
    const report = mineProductRegistrationPatterns({
      events: [
        event(1, { rawTextHash: 'same-source', attemptNo: 0 }),
        event(2, { rawTextHash: 'same-source', attemptNo: 1 }),
        event(3, { rawTextHash: 'same-source', attemptNo: 2 }),
        event(4, { rawTextHash: 'same-source', attemptNo: 3 }),
      ],
      minEvents: 50,
      minFailedOrReviewNeeded: 10,
      minRepeatedBlockers: 5,
    });

    const dayTable = report.candidates.find(candidate =>
      candidate.kind === 'supplier_format' && candidate.signature === 'catalog_pkg',
    );

    expect(dayTable).toEqual(expect.objectContaining({
      evidenceCount: 4,
      independentSourceCount: 1,
      autoFixSuccessRate: 1,
      promotionReady: false,
    }));
  });

  it('runs macro mining when failed review events cross the threshold', () => {
    const events = Array.from({ length: 10 }, (_, index) => event(index, {
      finalStatus: 'REVIEW_NEEDED',
      blockersAfter: ['unknown format'],
      autoFixesApplied: [],
    }));
    const report = mineProductRegistrationPatterns({
      events,
      minFailedOrReviewNeeded: 10,
    });

    expect(report.shouldRun).toBe(true);
    expect(report.runReasons).toContain('failed_or_review:10>=10');
  });

  it('classifies macro candidates into parser-review work item families', () => {
    const report = mineProductRegistrationPatterns({
      events: [
        event(1, {
          detectedFormat: 'weekday_period_table',
          blockersBefore: [
            'price table heading alias 스팟특가 needs parser review',
            'itinerary schedule pollution: 항공편명 and 교통편 columns leaked into activity',
            '선택관광 추가요금 amount was seen near product price',
          ],
          evidenceSpans: [{
            field: 'hotel_room_grade',
            rawTextHash: 'hash-1',
            start: 0,
            end: 8,
            quote: '호텔(2인1실)',
            confidence: 0.9,
          }],
        }),
        event(2, {
          detectedFormat: 'weekday_period_table',
          blockersBefore: [
            'price table heading alias 스팟특가 needs parser review',
            'itinerary schedule pollution: 항공편명 and 교통편 columns leaked into activity',
            '선택관광 추가요금 amount was seen near product price',
          ],
          evidenceSpans: [{
            field: 'hotel_room_grade',
            rawTextHash: 'hash-2',
            start: 0,
            end: 8,
            quote: '호텔(2인1실)',
            confidence: 0.9,
          }],
        }),
      ],
      minEvents: 50,
      minFailedOrReviewNeeded: 10,
      minRepeatedBlockers: 5,
    });

    expect(report.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'price_table_alias', signature: 'weekday_period_table' }),
      expect.objectContaining({ kind: 'itinerary_column_alias', signature: 'weekday_period_table' }),
      expect.objectContaining({ kind: 'optional_tour_phrase', signature: 'weekday_period_table' }),
      expect.objectContaining({ kind: 'hotel_room_grade_alias', signature: 'weekday_period_table' }),
      expect.objectContaining({ kind: 'flight_time_vehicle_pollution', signature: 'weekday_period_table' }),
    ]));
  });

  it('mines itinerary entity classification candidates without production mutation', () => {
    const report = mineProductRegistrationPatterns({
      events: [
        event(1, {
          detectedFormat: 'day_table',
          blockersBefore: [
            'entity.attraction_unresolved: Da Nang rice noodle was classified as attraction',
            'entity.shopping_review_needed: shopping center requires customer disclosure review',
            'entity.option_review_needed: massage option requires customer disclosure review',
          ],
          evidenceSpans: [{
            field: 'entity_classification',
            rawTextHash: 'hash-1',
            start: 0,
            end: 12,
            quote: 'Da Nang rice noodle',
            confidence: 0.9,
          }],
        }),
        event(2, {
          detectedFormat: 'day_table',
          blockersBefore: [
            'entity.attraction_unresolved: Osaka rice noodle was classified as attraction',
            'entity.shopping_review_needed: shopping center requires customer disclosure review',
            'entity.option_review_needed: massage option requires customer disclosure review',
          ],
          evidenceSpans: [{
            field: 'entity_classification',
            rawTextHash: 'hash-2',
            start: 0,
            end: 12,
            quote: 'Osaka rice noodle',
            confidence: 0.9,
          }],
        }),
      ],
    });

    expect(report.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'entity_classification_pattern', signature: 'day_table' }),
      expect.objectContaining({ kind: 'regional_meal_alias', signature: 'day_table' }),
      expect.objectContaining({ kind: 'shopping_phrase_pattern', signature: 'day_table' }),
      expect.objectContaining({ kind: 'optional_tour_phrase_pattern', signature: 'day_table' }),
      expect.objectContaining({ kind: 'attraction_alias_candidate', signature: 'day_table' }),
    ]));
  });
});
