import { createHash } from 'node:crypto';

export const BLOG_AUTOPILOT_PIPELINE_VERSION = 'blog-autopilot-v4.0.0' as const;
export const BLOG_SEARCH_CLASSIFICATION_VERSION = 'blog-search-lifecycle-v4.0.0' as const;
export const BLOG_QUALITY_DECISION_VERSION = 'blog-quality-decision-v4.0.0' as const;
export const BLOG_QUALITY_RUBRIC_VERSION = 'blog-promptfoo-rubric-v4.0.0' as const;
export const BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION = '20260901114420' as const;

export function readBlogDeploymentCommitShaV4(): string {
  return String(
    process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || 'local-unknown',
  ).slice(0, 64);
}

export const BLOG_PIPELINE_STAGES = [
  'research',
  'brief',
  'draft',
  'verify',
  'edit',
  'quality',
  'preview',
  'publish',
  'indexing',
  'observe',
] as const;

export type BlogPipelineStage = (typeof BLOG_PIPELINE_STAGES)[number];

export const BLOG_SEARCH_LIFECYCLE_STATUSES = [
  'queued',
  'submitted',
  'received',
  'discovered',
  'crawled',
  'indexed',
  'ranking',
] as const;

export type BlogSearchLifecycleStatus = (typeof BLOG_SEARCH_LIFECYCLE_STATUSES)[number];

export const BLOG_PROVIDER_RECEIPT_STATUSES = [
  'unknown',
  'pending',
  'accepted',
  'rejected',
  'not_applicable',
] as const;

export type BlogProviderReceiptStatus = (typeof BLOG_PROVIDER_RECEIPT_STATUSES)[number];

export type BlogQualityDimensionScoreV4 = {
  score: number;
  passed: boolean;
  issues: string[];
  evaluatorVersion: string;
};

export type BlogQualityDecisionV4 = {
  version: typeof BLOG_QUALITY_DECISION_VERSION;
  passed: boolean;
  modelVersion: string;
  promptVersion: string;
  rubricVersion: typeof BLOG_QUALITY_RUBRIC_VERSION;
  claimHashBefore: string;
  claimHashAfter: string;
  deterministic: BlogQualityDimensionScoreV4;
  evidence: BlogQualityDimensionScoreV4;
  style: BlogQualityDimensionScoreV4;
  seo: BlogQualityDimensionScoreV4;
  publicRender: BlogQualityDimensionScoreV4;
  browserPreview: BlogQualityDimensionScoreV4 | null;
  decidedAt: string;
};

export type BlogSearchLifecycleEvidence = {
  requestStatus?: string | null;
  providerReceiptStatus?: BlogProviderReceiptStatus | null;
  indexStatus?: string | null;
  coverageState?: string | null;
  pageFetchState?: string | null;
  lastCrawlTime?: string | null;
  bestRank?: number | null;
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveBlogSearchLifecycleStatus(
  evidence: BlogSearchLifecycleEvidence,
): BlogSearchLifecycleStatus {
  const rank = Number(evidence.bestRank);
  if (Number.isFinite(rank) && rank > 0) return 'ranking';
  if (evidence.indexStatus === 'indexed') return 'indexed';
  if (hasText(evidence.lastCrawlTime)
    || /success|successful|crawled/i.test(String(evidence.pageFetchState || ''))) {
    return 'crawled';
  }
  if (/discovered|발견됨|known/i.test(String(evidence.coverageState || ''))) {
    return 'discovered';
  }
  if (evidence.providerReceiptStatus === 'accepted') return 'received';
  if (evidence.requestStatus === 'requested') return 'submitted';
  return 'queued';
}

export function resolveProviderReceiptStatus(input: {
  requestStatus?: string | null;
  providerOk?: boolean | null;
  verificationOnly?: boolean;
}): BlogProviderReceiptStatus {
  if (input.verificationOnly) return 'not_applicable';
  if (input.providerOk === true) return 'accepted';
  if (input.providerOk === false || input.requestStatus === 'request_failed') return 'rejected';
  if (input.requestStatus === 'requested') return 'pending';
  return 'unknown';
}

export function createBlogPipelineEventId(input: {
  queueId: string;
  contentVersion: string;
}): string {
  const queueId = input.queueId.trim().toLowerCase();
  const version = input.contentVersion.trim();
  const digest = createHash('sha256').update(`${queueId}:${version}`).digest('hex').slice(0, 20);
  return `blog-pipeline:${queueId}:${digest}`;
}

export function isBlogQualityDecisionPublishableV4(
  decision: BlogQualityDecisionV4,
): boolean {
  const dimensions = [
    decision.deterministic,
    decision.evidence,
    decision.style,
    decision.seo,
    decision.publicRender,
  ];
  return decision.passed
    && decision.modelVersion.length > 0
    && decision.modelVersion !== 'unknown'
    && decision.promptVersion.length > 0
    && decision.promptVersion !== 'unknown'
    && decision.rubricVersion === BLOG_QUALITY_RUBRIC_VERSION
    && decision.claimHashBefore.length > 0
    && decision.claimHashBefore === decision.claimHashAfter
    && dimensions.every((dimension) => dimension.passed && dimension.score === 100)
    && decision.browserPreview !== null
    && decision.browserPreview.passed
    && decision.browserPreview.score >= 95;
}

export function buildBlogQualityDecisionV4(input: {
  modelVersion: string;
  promptVersion: string;
  claimHashBefore: string;
  claimHashAfter: string;
  deterministicPassed: boolean;
  evidencePassed: boolean;
  stylePassed: boolean;
  seoPassed: boolean;
  publicRenderPassed: boolean;
  browserPreviewScore: number;
  browserPreviewPassed: boolean;
  issues?: Partial<Record<'deterministic' | 'evidence' | 'style' | 'seo' | 'publicRender' | 'browserPreview', string[]>>;
}): BlogQualityDecisionV4 {
  const dimension = (passed: boolean, key: keyof NonNullable<typeof input.issues>, evaluatorVersion: string) => ({
    score: passed ? 100 : 0,
    passed,
    issues: input.issues?.[key] ?? [],
    evaluatorVersion,
  });
  const decision: BlogQualityDecisionV4 = {
    version: BLOG_QUALITY_DECISION_VERSION,
    passed: false,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    rubricVersion: BLOG_QUALITY_RUBRIC_VERSION,
    claimHashBefore: input.claimHashBefore,
    claimHashAfter: input.claimHashAfter,
    deterministic: dimension(input.deterministicPassed, 'deterministic', 'blog-quality-v3'),
    evidence: dimension(input.evidencePassed, 'evidence', 'blog-information-claim-gate-v1'),
    style: dimension(input.stylePassed, 'style', 'blog-editorial-harness-v5'),
    seo: dimension(input.seoPassed, 'seo', 'blog-publish-quality-v3'),
    publicRender: dimension(input.publicRenderPassed, 'publicRender', 'blog-rendered-seo-quality-v1'),
    browserPreview: {
      score: Math.max(0, Math.min(100, input.browserPreviewScore)),
      passed: input.browserPreviewPassed,
      issues: input.issues?.browserPreview ?? [],
      evaluatorVersion: 'blog-browser-preview-v4',
    },
    decidedAt: new Date().toISOString(),
  };
  decision.passed = isBlogQualityDecisionPublishableV4({ ...decision, passed: true });
  return decision;
}
