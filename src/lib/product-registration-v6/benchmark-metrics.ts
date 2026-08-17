import type { ProductRegistrationV6TerminalOutcome } from './types';

export type ProductRegistrationBenchmarkCase = {
  caseId?: string;
  inputKind: 'hwp' | 'text';
  extractionSucceeded: boolean;
  segmentExact: boolean;
  predictedOutcome: 'verified' | 'degraded' | 'blocked';
  predictedTerminalOutcome?: ProductRegistrationV6TerminalOutcome;
  expectedTerminalOutcome?: ProductRegistrationV6TerminalOutcome;
  publicationEligible?: boolean;
  expectedSourceIncompleteDiscard?: boolean;
  criticalFalsePublish: boolean;
  criticalFieldCount: number;
  criticalExactCount: number;
  parserFallbackUsed?: boolean;
  parserDisagreement?: boolean;
  lineageHash: string;
  split: 'development' | 'calibration' | 'frozen';
  supplierKey?: string | null;
  documentFamily?: string | null;
  doubleReviewed?: boolean;
  firstReviewHash?: string | null;
  secondReviewHash?: string | null;
  adjudicationHash?: string | null;
};

export type ProductRegistrationBenchmarkSummary = {
  sampleCount: number;
  publicationEligibleCount: number;
  expectedSourceIncompleteDiscardCount: number;
  correctSourceIncompleteDiscardCount: number;
  falseSourceIncompleteDiscardCount: number;
  invalidSourcePublishedCount: number;
  sourceIncompleteDiscardExactRate: number;
  negativeTerminalOutcomeExactRate: number;
  safeOpenCount: number;
  safeOpenRate: number;
  safeOpenWilsonLowerBound: number;
  criticalFieldCount: number;
  criticalExactCount: number;
  criticalExactMatchRate: number;
  criticalFalsePublishCount: number;
  segmentExactMatchRate: number;
  extractionSuccessRate: number;
  parserFallbackRate: number;
  parserDisagreementRate: number;
};

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** One-sided 95% Wilson lower confidence bound (z=1.6448536269514722). */
export function oneSidedWilsonLowerBound(successes: number, total: number): number {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < 0 || successes > total) {
    throw new Error('BENCHMARK_WILSON_INPUT_INVALID');
  }
  if (total === 0) return 0;
  const z = 1.6448536269514722;
  const phat = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0, (center - margin) / denominator);
}

export function assertNoLineageSplitLeakage(cases: ProductRegistrationBenchmarkCase[]): void {
  const splitsByLineage = new Map<string, Set<string>>();
  for (const item of cases) {
    const splits = splitsByLineage.get(item.lineageHash) ?? new Set<string>();
    splits.add(item.split);
    splitsByLineage.set(item.lineageHash, splits);
  }
  const leaked = [...splitsByLineage.entries()].filter(([, splits]) => splits.size > 1);
  if (leaked.length > 0) {
    throw new Error(`BENCHMARK_LINEAGE_SPLIT_LEAKAGE:${leaked.map(([lineage]) => lineage).join(',')}`);
  }
}

export function assertReviewedBenchmarkCases(cases: ProductRegistrationBenchmarkCase[]): void {
  const invalid = cases.filter(item => {
    if (!item.doubleReviewed) return true;
    if (item.adjudicationHash) return false;
    return !item.firstReviewHash
      || !item.secondReviewHash
      || item.firstReviewHash !== item.secondReviewHash;
  });
  if (invalid.length > 0) {
    throw new Error(`BENCHMARK_GROUND_TRUTH_NOT_DOUBLE_REVIEWED:${invalid.map((item, index) => item.caseId ?? index).join(',')}`);
  }
}

export function summarizeProductRegistrationBenchmark(
  cases: ProductRegistrationBenchmarkCase[],
): ProductRegistrationBenchmarkSummary {
  assertNoLineageSplitLeakage(cases);
  const sampleCount = cases.length;
  const publicationEligibleCases = cases.filter(item => item.publicationEligible ?? !item.expectedSourceIncompleteDiscard);
  const expectedDiscardCases = cases.filter(item => item.expectedSourceIncompleteDiscard);
  const negativeTerminalCases = cases.filter(item => item.expectedTerminalOutcome);
  const correctNegativeTerminalCount = negativeTerminalCases.filter(item =>
    item.predictedTerminalOutcome === item.expectedTerminalOutcome).length;
  const correctSourceIncompleteDiscardCount = expectedDiscardCases.filter(item =>
    item.predictedTerminalOutcome === 'discarded_source_incomplete').length;
  const falseSourceIncompleteDiscardCount = publicationEligibleCases.filter(item =>
    item.predictedTerminalOutcome === 'discarded_source_incomplete').length;
  const invalidSourcePublishedCount = expectedDiscardCases.filter(item =>
    item.predictedOutcome !== 'blocked').length;
  const safeOpenCount = publicationEligibleCases.filter(item => (
    item.extractionSucceeded
    && item.segmentExact
    && item.predictedOutcome !== 'blocked'
    && !item.criticalFalsePublish
  )).length;
  const criticalFieldCount = cases.reduce((sum, item) => sum + item.criticalFieldCount, 0);
  const criticalExactCount = cases.reduce((sum, item) => sum + item.criticalExactCount, 0);
  return {
    sampleCount,
    publicationEligibleCount: publicationEligibleCases.length,
    expectedSourceIncompleteDiscardCount: expectedDiscardCases.length,
    correctSourceIncompleteDiscardCount,
    falseSourceIncompleteDiscardCount,
    invalidSourcePublishedCount,
    sourceIncompleteDiscardExactRate: expectedDiscardCases.length > 0
      ? rate(correctSourceIncompleteDiscardCount, expectedDiscardCases.length)
      : 1,
    negativeTerminalOutcomeExactRate: negativeTerminalCases.length > 0
      ? rate(correctNegativeTerminalCount, negativeTerminalCases.length)
      : 1,
    safeOpenCount,
    safeOpenRate: rate(safeOpenCount, publicationEligibleCases.length),
    safeOpenWilsonLowerBound: oneSidedWilsonLowerBound(safeOpenCount, publicationEligibleCases.length),
    criticalFieldCount,
    criticalExactCount,
    criticalExactMatchRate: rate(criticalExactCount, criticalFieldCount),
    criticalFalsePublishCount: cases.filter(item => item.criticalFalsePublish).length,
    segmentExactMatchRate: rate(cases.filter(item => item.segmentExact).length, sampleCount),
    extractionSuccessRate: rate(cases.filter(item => item.extractionSucceeded).length, sampleCount),
    parserFallbackRate: rate(cases.filter(item => item.parserFallbackUsed).length, sampleCount),
    parserDisagreementRate: rate(cases.filter(item => item.parserDisagreement).length, sampleCount),
  };
}

export function majorCohortSafeOpenRate(input: {
  cases: ProductRegistrationBenchmarkCase[];
  minimumSections?: number;
  minimumLineages?: number;
}): { minimumRate: number; eligibleCohortCount: number; cohorts: Array<{ key: string; count: number; lineageCount: number; rate: number }> } {
  const minimumSections = input.minimumSections ?? 30;
  const minimumLineages = input.minimumLineages ?? 10;
  const grouped = new Map<string, ProductRegistrationBenchmarkCase[]>();
  for (const item of input.cases) {
    const key = `${item.supplierKey ?? 'unknown'}|${item.documentFamily ?? 'unknown'}|${item.inputKind}`;
    const values = grouped.get(key) ?? [];
    values.push(item);
    grouped.set(key, values);
  }
  const cohorts = [...grouped.entries()].map(([key, values]) => {
    const eligibleValues = values.filter(item => item.publicationEligible ?? !item.expectedSourceIncompleteDiscard);
    const safe = eligibleValues.filter(item => item.extractionSucceeded
      && item.segmentExact
      && item.predictedOutcome !== 'blocked'
      && !item.criticalFalsePublish).length;
    return {
      key,
      count: eligibleValues.length,
      lineageCount: new Set(eligibleValues.map(item => item.lineageHash)).size,
      rate: rate(safe, eligibleValues.length),
    };
  }).filter(item => item.count >= minimumSections && item.lineageCount >= minimumLineages);
  return {
    minimumRate: cohorts.length > 0 ? Math.min(...cohorts.map(item => item.rate)) : 0,
    eligibleCohortCount: cohorts.length,
    cohorts: cohorts.sort((left, right) => left.rate - right.rate || left.key.localeCompare(right.key)),
  };
}

export function benchmarkMeetsCustomerOpenGate(input: {
  summary: ProductRegistrationBenchmarkSummary;
  frozenSectionCount: number;
  majorCohortMinimumRate: number;
}): boolean {
  return input.frozenSectionCount >= 400
    && input.summary.safeOpenRate >= 0.97
    && input.summary.safeOpenWilsonLowerBound >= 0.95
    && input.summary.criticalExactMatchRate >= 0.995
    && input.summary.criticalFalsePublishCount === 0
    && input.summary.falseSourceIncompleteDiscardCount === 0
    && input.summary.invalidSourcePublishedCount === 0
    && input.summary.sourceIncompleteDiscardExactRate === 1
    && input.summary.negativeTerminalOutcomeExactRate === 1
    && input.summary.segmentExactMatchRate >= 0.995
    && input.summary.extractionSuccessRate >= 0.995
    && input.majorCohortMinimumRate >= 0.9;
}
