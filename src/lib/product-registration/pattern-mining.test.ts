import { describe, expect, it } from 'vitest';
import type { ImprovementLedgerEvent } from './improvement-ledger';
import { mineProductRegistrationPatterns } from './pattern-mining';

function event(index: number, overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  return {
    uploadId: `upload-${index}`,
    productId: null,
    packageId: null,
    attemptNo: 1,
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
        promotionReady: true,
      }),
      expect.objectContaining({
        kind: 'deterministic_fix',
        signature: 'price_dates',
        promotionReady: true,
      }),
    ]));
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
});
