import { describe, expect, it } from 'vitest';

import {
  buildBlindLearningReviewQueue,
  createProductRegistrationLearningCycle,
  learningBlockerFamily,
  normalizeLearningBlocker,
  selectDiverseLearningCases,
  type LearningManifest,
  type LearningObservation,
} from './learning-loop';

function entry(input: {
  hash: string;
  split?: 'development' | 'calibration' | 'frozen';
  outcome?: 'verified' | 'degraded' | 'blocked';
  blocker?: string;
  disposition?: string;
  terminalOutcome?: string;
}): NonNullable<LearningManifest['entries']>[number] {
  return {
    sourcePath: `C:/private/${input.hash}.hwp`,
    filename: `${input.hash}.hwp`,
    sourceHash: input.hash.padEnd(64, '0'),
    lineageHash: `lineage-${input.hash}`,
    split: input.split ?? 'development',
    duplicateOf: null,
    documentClass: 'travel_product',
    prelabel: {
      sectionCount: 1,
      sectionHashes: [`section-${input.hash}`],
      outcomes: [input.outcome ?? 'blocked'],
      terminalOutcomes: input.terminalOutcome ? [input.terminalOutcome] : undefined,
      kernelSectionBlockers: [[...(input.blocker ? [input.blocker] : [])]],
      sectionBlockers: [[]],
      departureDatePolicy: { sectionDispositions: [input.disposition ?? 'eligible_future'] },
    },
  };
}

describe('product registration learning loop', () => {
  it('normalizes repeated indexes so one source cohort does not look like many blocker families', () => {
    expect(normalizeLearningBlocker('sections[9]:PRICE_DATE_YEAR_CONFLICT:7'))
      .toBe('sections[*]:PRICE_DATE_YEAR_CONFLICT');
    expect(learningBlockerFamily('sections[2]:PRICE_DATE_YEAR_CONFLICT:1')).toBe('departure_year');
    expect(normalizeLearningBlocker('sections[3]:PRICE_DATE_WEEKDAY_CONFLICT:4'))
      .toBe('sections[*]:PRICE_DATE_WEEKDAY_CONFLICT');
    expect(learningBlockerFamily('PRICE_DATE_WEEKDAY_CONFLICT:4')).toBe('departure_year');
    expect(learningBlockerFamily('sections[2].variants[0]:CUSTOMER_FACT_CONTRADICTION:NO_SHOPPING_WITH_SHOPPING_ITEMS'))
      .toBe('commercial_contradiction');
    expect(learningBlockerFamily('sections[0]:SOURCE_SALE_PRICE_REQUIRES_RESOLUTION: 원문에 판매가 후보가 있지만 가격 엔진이 확정하지 못했습니다.'))
      .toBe('price_evidence');
  });

  it('never exposes individual frozen cases to learning or review selection', () => {
    const manifest: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [
        entry({ hash: 'dev', blocker: '판매가와 출발일 적용 관계가 불명확합니다.' }),
        entry({ hash: 'frozen-secret', split: 'frozen', blocker: '판매가와 출발일 적용 관계가 불명확합니다.' }),
      ],
    };
    const cycle = createProductRegistrationLearningCycle({ manifest, generatedAt: '2026-08-14T00:00:00.000Z' });
    expect(cycle.frozenIndividualCasesInspected).toBe(false);
    expect(cycle.summaries.frozen.allSections).toBe(1);
    expect(cycle.selectedReviewCases.map(item => item.filename)).toEqual(['dev.hwp']);
    expect(JSON.stringify(cycle.clusters)).not.toContain('frozen-secret');
  });

  it('selects a risk-diverse batch with one case per lineage and a family quota', () => {
    const observation = (id: string, family: LearningObservation['primaryFamily'], score: number): LearningObservation => ({
      caseId: id,
      sourcePath: `C:/${id}.hwp`,
      filename: `${id}.hwp`,
      sourceHash: `${id}-hash`,
      lineageHash: `${id}-lineage`,
      split: 'development',
      sectionIndex: 0,
      sectionHash: `${id}-section`,
      outcome: 'blocked',
      blockers: [family],
      blockerFamilies: [family],
      primaryFamily: family,
      learningMethod: family === 'price_date_scope' ? 'dual_ai_evidence_consensus' : 'supplier_profile_fixture',
      priorityScore: score,
    });
    const selected = selectDiverseLearningCases({
      observations: [
        observation('price-1', 'price_date_scope', 100),
        observation('price-2', 'price_date_scope', 99),
        observation('price-3', 'price_date_scope', 98),
        observation('itinerary-1', 'itinerary', 80),
        observation('terms-1', 'inclusions_exclusions', 70),
      ],
      maximumCases: 3,
      maximumPerFamily: 1,
    });
    expect(new Set(selected.map(item => item.primaryFamily))).toEqual(new Set([
      'price_date_scope',
      'itinerary',
      'inclusions_exclusions',
    ]));
  });

  it('creates a blinded queue without blockers or engine outcomes', () => {
    const manifest: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [entry({ hash: 'case-a', blocker: '판매가와 출발일 적용 관계가 불명확합니다.' })],
    };
    const cycle = createProductRegistrationLearningCycle({ manifest, generatedAt: '2026-08-14T00:00:00.000Z' });
    const queue = buildBlindLearningReviewQueue({ manifestPath: 'C:/private/manifest.json', cycle });
    expect(queue.engineOutputsIncluded).toBe(false);
    expect(JSON.stringify(queue)).not.toContain('적용 관계');
    expect(JSON.stringify(queue)).not.toContain('blocked');
  });

  it('records recovery and blocks promotion without reviewed evidence or after regression', () => {
    const previous: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [
        entry({ hash: 'recovered', outcome: 'blocked', blocker: '성인 기준 판매가가 없습니다.' }),
        entry({ hash: 'regressed', outcome: 'verified' }),
      ],
    };
    const current: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [
        entry({ hash: 'recovered', outcome: 'verified' }),
        entry({ hash: 'regressed', outcome: 'blocked', blocker: '포함사항을 확인할 수 없습니다.' }),
      ],
    };
    const cycle = createProductRegistrationLearningCycle({
      manifest: current,
      previousManifest: previous,
      promotionEvidence: {
        reviewedFrozenSectionCount: 300,
        criticalExactMatchRate: 1,
        criticalFalsePublicationCount: 0,
        customerOpenGatePassed: true,
        consecutiveFrozenPasses: 2,
      },
      generatedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(cycle.regression).toMatchObject({ recoveredSections: 1, regressedSections: 1 });
    expect(cycle.promotion.eligible).toBe(false);
    expect(cycle.promotion.reasons).toContain('ACTIVE_REGRESSION_DETECTED:1');
  });

  it('does not compare different product sections merely because their array index is the same', () => {
    const previousEntry = entry({ hash: 'split-source', outcome: 'verified' });
    previousEntry.prelabel.sectionHashes = ['old-whole-document'];
    const currentEntry = entry({ hash: 'split-source', outcome: 'blocked' });
    currentEntry.prelabel.sectionCount = 2;
    currentEntry.prelabel.sectionHashes = ['new-product-a', 'new-product-b'];
    currentEntry.prelabel.outcomes = ['blocked', 'verified'];
    currentEntry.prelabel.kernelSectionBlockers = [['new product needs price binding'], []];
    currentEntry.prelabel.sectionBlockers = [[], []];
    currentEntry.prelabel.departureDatePolicy = { sectionDispositions: ['eligible_future', 'eligible_future'] };
    const cycle = createProductRegistrationLearningCycle({
      manifest: { schemaVersion: 'product-registration-private-corpus-1', entries: [currentEntry] },
      previousManifest: { schemaVersion: 'product-registration-private-corpus-1', entries: [previousEntry] },
      generatedAt: '2026-08-16T00:00:00.000Z',
    });

    expect(cycle.regression).toMatchObject({
      comparableSections: 0,
      recoveredSections: 0,
      regressedSections: 0,
    });
  });

  it('treats past-only cases as safe terminal outcomes but not active publication candidates', () => {
    const manifest: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [entry({ hash: 'past', disposition: 'past_only_excluded' })],
    };
    const cycle = createProductRegistrationLearningCycle({ manifest, generatedAt: '2026-08-14T00:00:00.000Z' });
    expect(cycle.summaries.development).toEqual({
      allSections: 1,
      pastOnlyExcluded: 1,
      discardedSourceIncomplete: 0,
      activeSections: 0,
      publicationEligibleSections: 0,
      safeSections: 0,
      blockedSections: 0,
      activeSafeRate: 0,
      publicationEligibleSafeRate: 0,
    });
    expect(cycle.selectedReviewCases).toHaveLength(0);
  });

  it('reports newly discarded price-less sources as safety tightening, not regression', () => {
    const previous: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [entry({ hash: 'no-sale', outcome: 'degraded' })],
    };
    const current: LearningManifest = {
      schemaVersion: 'product-registration-private-corpus-1',
      entries: [entry({
        hash: 'no-sale',
        outcome: 'blocked',
        blocker: '성인 기준 판매가가 없습니다.',
        terminalOutcome: 'discarded_source_incomplete',
      })],
    };
    const cycle = createProductRegistrationLearningCycle({
      manifest: current,
      previousManifest: previous,
      promotionEvidence: {
        reviewedFrozenSectionCount: 300,
        criticalExactMatchRate: 1,
        criticalFalsePublicationCount: 0,
        customerOpenGatePassed: true,
        consecutiveFrozenPasses: 2,
      },
      generatedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(cycle.regression).toMatchObject({
      comparableSections: 1,
      safetyTightenedSections: 1,
      regressedSections: 0,
    });
    expect(cycle.promotion.reasons).not.toContain('ACTIVE_REGRESSION_DETECTED:1');
  });
});
