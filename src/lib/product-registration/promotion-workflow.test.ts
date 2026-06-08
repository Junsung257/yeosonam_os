import { describe, expect, it } from 'vitest';

import type { ImprovementLedgerEvent } from './improvement-ledger';
import type { PatternCandidate } from './pattern-mining';
import { buildPromotionWorkItems } from './promotion-workflow';

function event(overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  return {
    uploadId: 'upload-1',
    productId: 'PUS-LA-PQC-05-0001',
    packageId: '550e8400-e29b-41d4-a716-446655440000',
    attemptNo: 1,
    attemptPhase: 'deterministic_source_recompare',
    rawTextHash: 'a'.repeat(64),
    sectionRawTextHash: null,
    parserVersion: 'product-registration-central',
    detectedFormat: 'catalog_pkg',
    blockersBefore: ['price storage mismatch'],
    blockersAfter: [],
    normalizedBlockerSignatures: ['price storage mismatch'],
    evidenceSpans: [],
    comparedFields: ['product_prices', 'price_dates'],
    autoFixesApplied: [{
      field: 'price_dates',
      kind: 'deterministic',
      reason: 'rebuild date-level minimum from product_prices',
      confidence: 0.95,
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

function candidate(overrides: Partial<PatternCandidate> = {}): PatternCandidate {
  return {
    id: 'deterministic_fix:price_dates',
    kind: 'deterministic_fix',
    signature: 'price_dates',
    evidenceCount: 3,
    independentSourceCount: 3,
    successCount: 3,
    failureCount: 0,
    autoFixSuccessRate: 1,
    risk: 'low',
    exampleRawTextHashes: ['a'.repeat(64)],
    recommendedAction: 'Promote to reviewed parser-rule candidate with fixture coverage.',
    promotionReady: true,
    ...overrides,
  };
}

describe('buildPromotionWorkItems', () => {
  it('turns promotion-ready macro candidates into reviewed fixture and parser-rule work items', () => {
    const workItems = buildPromotionWorkItems({
      candidates: [candidate()],
      events: [event()],
    });

    expect(workItems).toHaveLength(1);
    expect(workItems[0]).toEqual(expect.objectContaining({
      status: 'review_required',
      signature: 'price_dates',
      evidenceRawTextHashes: ['a'.repeat(64)],
      evidencePackageIds: ['550e8400-e29b-41d4-a716-446655440000'],
    }));
    expect(workItems[0].fixturePlan.assertions).toEqual(expect.arrayContaining([
      expect.stringContaining('price_dates'),
    ]));
    expect(workItems[0].parserRulePlan.targetModules).toEqual(expect.arrayContaining([
      'src/lib/product-registration/price-recovery.ts',
    ]));
    expect(workItems[0].parserRulePlan.safetyChecks).toEqual(expect.arrayContaining([
      expect.stringContaining('Do not edit src/app/api/upload/route.ts'),
    ]));
    expect(workItems[0].verificationCommands).toContain('npm run eval:product-registration:ci');
  });

  it('does not create work items for candidates that are not promotion-ready', () => {
    const workItems = buildPromotionWorkItems({
      candidates: [candidate({ promotionReady: false })],
      events: [event()],
    });

    expect(workItems).toEqual([]);
  });

  it('keeps evidence links for detected-format macro candidate families', () => {
    const workItems = buildPromotionWorkItems({
      candidates: [
        candidate({
          id: 'price_table_alias:weekday_period_table',
          kind: 'price_table_alias',
          signature: 'weekday_period_table',
          evidenceCount: 3,
        }),
      ],
      events: [
        event({
          detectedFormat: 'weekday_period_table',
          rawTextHash: 'b'.repeat(64),
          packageId: '660e8400-e29b-41d4-a716-446655440000',
        }),
      ],
    });

    expect(workItems[0]).toEqual(expect.objectContaining({
      evidenceRawTextHashes: ['b'.repeat(64)],
      evidencePackageIds: ['660e8400-e29b-41d4-a716-446655440000'],
    }));
    expect(workItems[0].parserRulePlan.targetModules).toContain('src/lib/product-registration/price-recovery.ts');
  });

  it('routes itinerary entity candidates through review-gated work items', () => {
    const workItems = buildPromotionWorkItems({
      candidates: [
        candidate({
          id: 'entity_classification_pattern:day_table',
          kind: 'entity_classification_pattern',
          signature: 'day_table',
        }),
      ],
      events: [
        event({
          detectedFormat: 'day_table',
          rawTextHash: 'c'.repeat(64),
          blockersBefore: ['entity.attraction_unresolved: rice noodle needs meal classification'],
        }),
      ],
    });

    expect(workItems[0].parserRulePlan.targetModules).toEqual(expect.arrayContaining([
      'src/lib/product-registration-v3/entity-normalizer.ts',
      'src/lib/product-registration-v3/gate.ts',
    ]));
    expect(workItems[0].fixturePlan.assertions).toEqual(expect.arrayContaining([
      expect.stringContaining('new attraction master records are never created automatically'),
    ]));
    expect(workItems[0].parserRulePlan.safetyChecks).toEqual(expect.arrayContaining([
      expect.stringContaining('Never auto-create new attractions'),
    ]));
  });
});
