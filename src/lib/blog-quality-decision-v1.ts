import { createHash } from 'node:crypto';

export const BLOG_FINAL_QUALITY_DECISION_VERSION_V1 = 'blog-final-quality-decision-v1';
export const BLOG_FINAL_QUALITY_MINIMUM_SCORE_V1 = 90;

export type BlogFinalQualityDecisionStatusV1 =
  | 'pass'
  | 'repairable_fail'
  | 'human_review'
  | 'reject';

export interface BlogFinalQualityDecisionV1 {
  schemaVersion: 1;
  revisionId: string;
  evaluatorVersion: string;
  overallScore: number;
  minimumScore: number;
  hardBlockers: string[];
  warnings: string[];
  decision: BlogFinalQualityDecisionStatusV1;
  passed: boolean;
  evaluatedContentHash: string;
  comparisonCorpusVersion: string;
  evaluatedAt: string;
}

export interface BlogOperationStateV1 {
  generationStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  reviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected' | 'changes_requested';
  publicationStatus: 'not_eligible' | 'quality_blocked' | 'suppressed_by_policy' | 'not_attempted' | 'queued' | 'publishing' | 'published' | 'failed';
  indexingStatus: 'not_eligible' | 'not_attempted' | 'queued' | 'processing' | 'succeeded' | 'failed';
  finalRevisionId: string | null;
  finalQualityDecisionId: string | null;
}

type QualityReportLike = {
  passed?: boolean;
  score?: number | null;
  hardBlockers?: string[] | null;
  failureReasons?: Array<{ code?: string } | string> | null;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeFailureReasons(value: QualityReportLike['failureReasons']): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === 'string' ? item : String(item?.code || '')).filter(Boolean);
}

export function hashBlogContentRevisionV1(input: {
  blogHtml: string;
  title: string;
  description: string;
  slug: string;
}): string {
  return createHash('sha256')
    .update([input.blogHtml, input.title, input.description, input.slug].join('\n'))
    .digest('hex');
}

export function buildBlogFinalQualityDecisionV1(input: {
  revisionId: string;
  evaluatedContentHash: string;
  comparisonCorpusVersion: string;
  qualityEvaluation: QualityReportLike;
  publishQuality?: QualityReportLike;
  claimValidationPassed?: boolean;
  preflightPassed?: boolean;
  humanReviewRequired?: boolean;
  warnings?: string[];
  evaluatedAt?: string;
}): BlogFinalQualityDecisionV1 {
  const qualityFailures = normalizeFailureReasons(input.qualityEvaluation.failureReasons);
  const publishFailures = normalizeFailureReasons(input.publishQuality?.failureReasons);
  const hardBlockers = unique([
    ...(input.qualityEvaluation.hardBlockers || []),
    ...qualityFailures,
    ...(input.publishQuality?.hardBlockers || []),
    ...publishFailures,
    ...(input.claimValidationPassed === false ? ['claim_validation_failed'] : []),
    ...(input.preflightPassed === false ? ['publish_preflight_failed'] : []),
  ]);
  const scoreValues = [input.qualityEvaluation.score, input.publishQuality?.score]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const overallScore = scoreValues.length > 0 ? Math.min(...scoreValues) : 0;
  const passed = input.qualityEvaluation.passed === true
    && (input.publishQuality?.passed ?? true) === true
    && input.claimValidationPassed !== false
    && input.preflightPassed !== false
    && input.humanReviewRequired !== true
    && hardBlockers.length === 0
    && overallScore >= BLOG_FINAL_QUALITY_MINIMUM_SCORE_V1;
  const repairableCodes = new Set([
    'opening_too_similar',
    'heading_tree_too_similar',
    'structure_integrity',
    'article_quality_v2',
    'ai_readability',
  ]);
  const onlyRepairable = hardBlockers.length > 0 && hardBlockers.every((code) => repairableCodes.has(code));
  const decision: BlogFinalQualityDecisionStatusV1 = passed
    ? 'pass'
    : input.humanReviewRequired === true
      ? 'human_review'
      : onlyRepairable
        ? 'repairable_fail'
        : 'reject';
  return {
    schemaVersion: 1,
    revisionId: input.revisionId,
    evaluatorVersion: BLOG_FINAL_QUALITY_DECISION_VERSION_V1,
    overallScore,
    minimumScore: BLOG_FINAL_QUALITY_MINIMUM_SCORE_V1,
    hardBlockers,
    warnings: unique(input.warnings || []),
    decision,
    passed,
    evaluatedContentHash: input.evaluatedContentHash,
    comparisonCorpusVersion: input.comparisonCorpusVersion,
    evaluatedAt: input.evaluatedAt || new Date().toISOString(),
  };
}

export function buildBlogOperationStateV1(input: {
  generationSucceeded: boolean;
  finalQualityDecision: BlogFinalQualityDecisionV1 | null;
  finalQualityDecisionId?: string | null;
  reviewRequired: boolean;
  publicationSuppressed: boolean;
  publicationAttempted?: boolean;
  publicationSucceeded?: boolean;
  indexingAttempted?: boolean;
  indexingSucceeded?: boolean;
}): BlogOperationStateV1 {
  const quality = input.finalQualityDecision;
  const generationStatus = input.generationSucceeded ? 'succeeded' : 'failed';
  const publicationStatus = input.publicationSucceeded
    ? 'published'
    : input.publicationAttempted
      ? 'failed'
      : quality?.passed === true && input.publicationSuppressed
        ? 'suppressed_by_policy'
        : quality?.passed === true
          ? 'not_attempted'
          : 'quality_blocked';
  const indexingStatus = input.indexingSucceeded
    ? 'succeeded'
    : input.indexingAttempted
      ? 'failed'
      : publicationStatus === 'published'
        ? 'queued'
        : quality?.passed === true && input.publicationSuppressed
          ? 'not_attempted'
          : 'not_eligible';
  return {
    generationStatus,
    reviewStatus: input.reviewRequired ? 'pending' : 'not_required',
    publicationStatus,
    indexingStatus,
    finalRevisionId: quality?.revisionId || null,
    finalQualityDecisionId: input.finalQualityDecisionId || null,
  };
}
