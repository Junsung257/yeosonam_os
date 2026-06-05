import type { RagEvalFact, RagGoldenCase } from './rag-golden-cases';
import { RAG_GOLDEN_CASES } from './rag-golden-cases';

export interface RagEvalMetrics {
  contextRecall: number;
  answerRelevancy: number;
  faithfulness: number;
  citationCoverage: number;
}

export interface RagEvalCaseResult {
  id: string;
  description: string;
  passed: boolean;
  metrics: RagEvalMetrics;
  missingExpectedFacts: string[];
  missingAnswerFacts: string[];
  unsupportedClaims: string[];
  missingCitations: string[];
}

export interface RagEvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  average: RagEvalMetrics;
  results: RagEvalCaseResult[];
}

const DEFAULT_THRESHOLDS: Required<NonNullable<RagGoldenCase['thresholds']>> = {
  contextRecall: 1,
  answerRelevancy: 1,
  faithfulness: 1,
  citationCoverage: 1,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[()[\]{}"'`*_~.,!?;:|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function allTermsPresent(text: string, terms: string[]): boolean {
  const normalized = normalize(text);
  return terms.every((term) => normalized.includes(normalize(term)));
}

function factIdsMissingFrom(text: string, facts: RagEvalFact[]): string[] {
  return facts
    .filter((fact) => !allTermsPresent(text, fact.terms))
    .map((fact) => fact.id);
}

function fraction(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

function metricFromMissing(total: number, missing: number): number {
  return fraction(total - missing, total);
}

export function evaluateRagGoldenCase(testCase: RagGoldenCase): RagEvalCaseResult {
  const combinedContext = testCase.contexts
    .map((context) => `${context.title}\n${context.url ?? ''}\n${context.text}`)
    .join('\n\n');
  const answer = testCase.answer;

  const missingExpectedFacts = factIdsMissingFrom(combinedContext, testCase.expectedFacts);
  const missingAnswerFacts = factIdsMissingFrom(answer, testCase.expectedFacts);
  const unsupportedClaims = testCase.answerClaims
    .filter((claim) => allTermsPresent(answer, claim.terms) && !allTermsPresent(combinedContext, claim.terms))
    .map((claim) => claim.id);
  const absentClaimIds = testCase.answerClaims
    .filter((claim) => !allTermsPresent(answer, claim.terms))
    .map((claim) => claim.id);
  const missingCitations = testCase.requiredCitations
    .filter((citation) => !normalize(answer).includes(normalize(citation)));

  const metrics: RagEvalMetrics = {
    contextRecall: metricFromMissing(testCase.expectedFacts.length, missingExpectedFacts.length),
    answerRelevancy: metricFromMissing(testCase.expectedFacts.length, missingAnswerFacts.length),
    faithfulness: metricFromMissing(testCase.answerClaims.length, unsupportedClaims.length + absentClaimIds.length),
    citationCoverage: metricFromMissing(testCase.requiredCitations.length, missingCitations.length),
  };

  const thresholds = { ...DEFAULT_THRESHOLDS, ...(testCase.thresholds ?? {}) };
  const passed = (
    metrics.contextRecall >= thresholds.contextRecall &&
    metrics.answerRelevancy >= thresholds.answerRelevancy &&
    metrics.faithfulness >= thresholds.faithfulness &&
    metrics.citationCoverage >= thresholds.citationCoverage
  );

  return {
    id: testCase.id,
    description: testCase.description,
    passed,
    metrics,
    missingExpectedFacts,
    missingAnswerFacts,
    unsupportedClaims: [...unsupportedClaims, ...absentClaimIds],
    missingCitations,
  };
}

function averageMetric(results: RagEvalCaseResult[], key: keyof RagEvalMetrics): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, result) => sum + result.metrics[key], 0) / results.length;
}

export function evaluateRagGoldenSet(cases: RagGoldenCase[] = RAG_GOLDEN_CASES): RagEvalSummary {
  const results = cases.map(evaluateRagGoldenCase);
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : passed / total,
    average: {
      contextRecall: averageMetric(results, 'contextRecall'),
      answerRelevancy: averageMetric(results, 'answerRelevancy'),
      faithfulness: averageMetric(results, 'faithfulness'),
      citationCoverage: averageMetric(results, 'citationCoverage'),
    },
    results,
  };
}
