import { describe, expect, it } from 'vitest';

import {
  assertNoLineageSplitLeakage,
  assertReviewedBenchmarkCases,
  benchmarkMeetsCustomerOpenGate,
  majorCohortSafeOpenRate,
  oneSidedWilsonLowerBound,
  summarizeProductRegistrationBenchmark,
  type ProductRegistrationBenchmarkCase,
} from './benchmark-metrics';

function passingCases(count: number): ProductRegistrationBenchmarkCase[] {
  return Array.from({ length: count }, (_, index) => ({
    inputKind: index % 3 === 0 ? 'text' : 'hwp',
    extractionSucceeded: true,
    segmentExact: true,
    predictedOutcome: 'verified',
    criticalFalsePublish: false,
    criticalFieldCount: 10,
    criticalExactCount: 10,
    lineageHash: `lineage-${index}`,
    split: 'frozen',
    doubleReviewed: true,
    firstReviewHash: `review-${index}`,
    secondReviewHash: `review-${index}`,
  }));
}

describe('product registration 95 benchmark metrics', () => {
  it('uses the one-sided Wilson lower bound instead of the raw rate', () => {
    expect(oneSidedWilsonLowerBound(285, 300)).toBeLessThan(0.95);
    expect(oneSidedWilsonLowerBound(298, 300)).toBeGreaterThan(0.95);
  });

  it('rejects lineage leakage across development and frozen sets', () => {
    const cases = passingCases(2);
    cases[1] = { ...cases[1]!, lineageHash: cases[0]!.lineageHash, split: 'development' };
    expect(() => assertNoLineageSplitLeakage(cases)).toThrow('BENCHMARK_LINEAGE_SPLIT_LEAKAGE');
  });

  it('rejects engine prelabels and unresolved reviewer disagreement as ground truth', () => {
    const prelabel = { ...passingCases(1)[0]!, doubleReviewed: false };
    expect(() => assertReviewedBenchmarkCases([prelabel])).toThrow('BENCHMARK_GROUND_TRUTH_NOT_DOUBLE_REVIEWED');
    const conflict = { ...passingCases(1)[0]!, secondReviewHash: 'different' };
    expect(() => assertReviewedBenchmarkCases([conflict])).toThrow('BENCHMARK_GROUND_TRUTH_NOT_DOUBLE_REVIEWED');
    expect(() => assertReviewedBenchmarkCases([{ ...conflict, adjudicationHash: 'adjudicated' }])).not.toThrow();
  });

  it('requires major cohorts to have both enough sections and independent lineages', () => {
    const cases = passingCases(35).map((item, index) => ({
      ...item,
      inputKind: 'hwp' as const,
      supplierKey: 'supplier-a',
      documentFamily: 'tour',
      lineageHash: `lineage-${index % 12}`,
    }));
    const result = majorCohortSafeOpenRate({ cases });
    expect(result.eligibleCohortCount).toBe(1);
    expect(result.minimumRate).toBe(1);
  });

  it('counts a degraded case as safe only when it has no critical false publication', () => {
    const cases = passingCases(300);
    cases[0] = { ...cases[0]!, predictedOutcome: 'degraded' };
    cases[1] = { ...cases[1]!, predictedOutcome: 'degraded', criticalFalsePublish: true };
    const summary = summarizeProductRegistrationBenchmark(cases);
    expect(summary.safeOpenCount).toBe(299);
    expect(summary.criticalFalsePublishCount).toBe(1);
    expect(benchmarkMeetsCustomerOpenGate({ summary, frozenSectionCount: 300, majorCohortMinimumRate: 0.95 })).toBe(false);
  });

  it('scores non-product terminal outcomes without putting them in the publication denominator', () => {
    const eligible = passingCases(400);
    const nonTravel: ProductRegistrationBenchmarkCase = {
      ...passingCases(1)[0]!,
      caseId: 'non-travel',
      publicationEligible: false,
      expectedTerminalOutcome: 'discarded_non_travel',
      predictedOutcome: 'blocked',
      predictedTerminalOutcome: 'discarded_non_travel',
      criticalFieldCount: 1,
      criticalExactCount: 1,
    };
    const summary = summarizeProductRegistrationBenchmark([...eligible, nonTravel]);
    expect(summary.publicationEligibleCount).toBe(400);
    expect(summary.safeOpenRate).toBe(1);
    expect(summary.negativeTerminalOutcomeExactRate).toBe(1);
  });

  it('passes only a statistically supported frozen benchmark', () => {
    const summary = summarizeProductRegistrationBenchmark(passingCases(400));
    expect(benchmarkMeetsCustomerOpenGate({ summary, frozenSectionCount: 400, majorCohortMinimumRate: 0.95 })).toBe(true);
  });
});
