import { createHash } from 'node:crypto';

/**
 * Blog Quality Improvement V4
 *
 * This module is deliberately pure. It creates evaluation records and
 * proposals, but it never calls an LLM, writes a database row, publishes an
 * article, or changes a quality threshold.
 */

export const BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION = 4 as const;
export const BLOG_SAFE_INFORMATION_INTENTS_V4 = [
  'food_budget',
  'monthly_weather',
  'airport_transport',
  'local_transport',
  'hotel_areas',
  'family_budget',
  'itinerary',
  'shopping_souvenirs',
  'currency_payment',
] as const;

export type BlogSafeInformationIntentV4 =
  (typeof BLOG_SAFE_INFORMATION_INTENTS_V4)[number];

export type BlogQualityRecommendedActionV4 =
  | 'publish'
  | 'human_review'
  | 'repair'
  | 'quarantine';

export type BlogQualityScoreNameV4 =
  | 'factuality'
  | 'intent'
  | 'structure'
  | 'readability'
  | 'originality'
  | 'publicSurface'
  | 'seo'
  | 'imageRelevance'
  | 'ctaPressure';

export type BlogQualityScoresV4 = Record<BlogQualityScoreNameV4, number>;

export interface BlogQualityEvaluationV4 {
  schemaVersion: typeof BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION;
  candidateId: string;
  contentVersion: string;
  promptVersion: string;
  claimHash: string;
  sourceEvidenceHash: string;
  scores: BlogQualityScoresV4;
  blockers: string[];
  recommendedAction: BlogQualityRecommendedActionV4;
  evaluatedAt: string;
}

export type BlogImprovementProposalStatusV4 =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'verified';

export interface BlogContentImprovementChangeV4 {
  path: string;
  code: string;
  rationale: string;
  beforeHash: string;
  afterHash?: string;
}

export interface BlogContentImprovementProposalV4 {
  schemaVersion: typeof BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION;
  proposalId: string;
  candidateId: string;
  baseContentVersion: string;
  targetContentVersion: string;
  reasonCodes: string[];
  changes: BlogContentImprovementChangeV4[];
  evidenceRefs: string[];
  impact: {
    claimsChanged: boolean;
    publicSurfaceChanged: boolean;
    publicationRisk: 'none' | 'low' | 'high';
  };
  rollbackRef: string;
  status: BlogImprovementProposalStatusV4;
  proposedAt: string;
  approvalLineage?: BlogImprovementApprovalV4;
}

export interface BlogImprovementApprovalV4 {
  proposalId: string;
  status: 'approved' | 'rejected';
  actorId: string;
  approvedAt: string;
  reason: string;
}

export interface BlogPerformanceLearningSnapshotV4 {
  candidateId: string;
  window: '7d' | '28d' | '56d';
  cohort: {
    intent: string;
    positionBand: string;
    aiOverviewExposure?: 'yes' | 'no' | 'unknown';
  };
  metrics: {
    impressions: number;
    clicks: number;
    ctr: number;
    avgPosition: number | null;
    conversions: number;
  };
  observedAt: string;
}

export interface BlogQualityRegressionCaseV4 {
  id: string;
  intent: BlogSafeInformationIntentV4 | 'contract';
  passed: boolean;
  blockers: string[];
  details?: Record<string, unknown>;
}

export interface BlogQualityRegressionReportV4 {
  schemaVersion: typeof BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION;
  fixtureSetVersion: string;
  externalCalls: 0;
  publicMutations: 0;
  total: number;
  passed: number;
  failed: number;
  cases: BlogQualityRegressionCaseV4[];
  ok: boolean;
  evaluatedAt: string;
}

export interface BlogProductDecisionBriefV4 {
  productId: string;
  contentVersion: string;
  productSnapshotHash: string;
  title: string;
  destination: string;
  price: {
    amount: number;
    currency: string;
    basis: string;
    checkedAt: string;
  };
  inclusions: string[];
  exclusions: string[];
  travelerFit: string[];
  bookingChannel: string;
}

export interface BlogProductDecisionBriefReportV4 {
  passed: boolean;
  blockers: string[];
  productSnapshotHash: string | null;
  priceBasis: string | null;
}

export interface BlogQualityEvaluationInputV4 {
  candidateId: string;
  contentVersion: string;
  promptVersion: string;
  claimHash: string;
  sourceEvidenceHash: string;
  scores: BlogQualityScoresV4;
  /** Must come from the existing Blog V4 publish evaluator; scores alone never authorize publish. */
  publishGatePassed: boolean;
  blockers?: string[];
  evaluatedAt?: string;
}

export interface BlogContentImprovementProposalInputV4 {
  proposalId: string;
  candidateId: string;
  baseContentVersion: string;
  targetContentVersion: string;
  reasonCodes: string[];
  changes: BlogContentImprovementChangeV4[];
  evidenceRefs: string[];
  impact: BlogContentImprovementProposalV4['impact'];
  rollbackRef: string;
  proposedAt?: string;
}

export function evaluateBlogProductDecisionBriefV4(
  input: BlogProductDecisionBriefV4,
): BlogProductDecisionBriefReportV4 {
  const blockers: string[] = [];
  for (const [field, value] of [
    ['product_id', input.productId],
    ['content_version', input.contentVersion],
    ['product_snapshot_hash', input.productSnapshotHash],
    ['title', input.title],
    ['destination', input.destination],
    ['currency', input.price?.currency],
    ['price_basis', input.price?.basis],
    ['price_checked_at', input.price?.checkedAt],
    ['booking_channel', input.bookingChannel],
  ] as const) {
    if (typeof value !== 'string' || !value.trim()) blockers.push(`missing_${field}`);
  }
  if (!Number.isFinite(input.price?.amount) || input.price.amount < 0) blockers.push('invalid_price');
  if (!Array.isArray(input.inclusions) || input.inclusions.length === 0) blockers.push('missing_inclusions');
  if (!Array.isArray(input.exclusions) || input.exclusions.length === 0) blockers.push('missing_exclusions');
  if (!Array.isArray(input.travelerFit) || input.travelerFit.length === 0) blockers.push('missing_traveler_fit');
  return {
    passed: blockers.length === 0,
    blockers,
    productSnapshotHash: typeof input.productSnapshotHash === 'string' && input.productSnapshotHash.trim()
      ? input.productSnapshotHash
      : null,
    priceBasis: typeof input.price?.basis === 'string' && input.price.basis.trim() ? input.price.basis : null,
  };
}

const HIGH_RISK_BLOCKERS = new Set([
  'unsupported_number',
  'fake_source',
  'missing_evidence',
  'claim_hash_changed',
  'source_scope_mismatch',
  'missing_claim_hash',
  'missing_source_evidence_hash',
  'missing_content_version',
  'missing_prompt_version',
  'high_risk_intent',
  'publication_side_effect',
  'unauthorized_mutation',
]);

const REPAIRABLE_BLOCKERS = new Set([
  'style',
  'repetition',
  'readability',
  'heading_structure',
  'cta_pressure',
  'image_relevance',
]);

const SCORE_NAMES: BlogQualityScoreNameV4[] = [
  'factuality',
  'intent',
  'structure',
  'readability',
  'originality',
  'publicSurface',
  'seo',
  'imageRelevance',
  'ctaPressure',
];

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`blog_quality_v4_missing_${field}`);
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function validateScore(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`blog_quality_v4_invalid_score:${name}`);
  }
  return Math.round(value * 100) / 100;
}

function normalizeToken(value: string): string[] {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hashes atomic claim text, not the article's formatting or paragraph order. */
export function createBlogQualityClaimHash(claims: readonly string[]): string {
  const normalized = [...new Set(claims.map(claim => claim.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  return sha256(JSON.stringify(normalized));
}

export function createBlogQualityEvidenceHash(evidenceRefs: readonly string[]): string {
  return sha256(JSON.stringify(uniqueStrings([...evidenceRefs]).sort((a, b) => a.localeCompare(b))));
}

export function evaluateBlogQualityClaimHashPreservationV4(input: {
  beforeClaims: readonly string[];
  afterClaims: readonly string[];
}): { preserved: boolean; beforeHash: string; afterHash: string } {
  const beforeHash = createBlogQualityClaimHash(input.beforeClaims);
  const afterHash = createBlogQualityClaimHash(input.afterClaims);
  return { preserved: beforeHash === afterHash, beforeHash, afterHash };
}

function deriveRecommendedAction(
  blockers: readonly string[],
  scores: BlogQualityScoresV4,
  publishGatePassed: boolean,
): BlogQualityRecommendedActionV4 {
  const normalizedBlockers = uniqueStrings([...blockers]);
  if (normalizedBlockers.some(blocker => HIGH_RISK_BLOCKERS.has(blocker))) return 'quarantine';
  if (normalizedBlockers.length > 0 && normalizedBlockers.every(blocker => REPAIRABLE_BLOCKERS.has(blocker))) return 'repair';
  if (!publishGatePassed || normalizedBlockers.length > 0 || Math.min(...Object.values(scores)) < 95) return 'human_review';
  return 'publish';
}

/** Normalizes an existing evaluator result into the V4 audit contract. */
export function buildBlogQualityEvaluationV4(
  input: BlogQualityEvaluationInputV4,
): BlogQualityEvaluationV4 {
  const candidateId = requireNonEmpty(input.candidateId, 'candidate_id');
  const contentVersion = requireNonEmpty(input.contentVersion, 'content_version');
  const promptVersion = requireNonEmpty(input.promptVersion, 'prompt_version');
  const claimHash = requireNonEmpty(input.claimHash, 'claim_hash');
  const sourceEvidenceHash = requireNonEmpty(input.sourceEvidenceHash, 'source_evidence_hash');
  const scores = Object.fromEntries(SCORE_NAMES.map(name => [name, validateScore(input.scores[name], name)])) as BlogQualityScoresV4;
  const blockers = uniqueStrings(input.blockers ?? []);
  return {
    schemaVersion: BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION,
    candidateId,
    contentVersion,
    promptVersion,
    claimHash,
    sourceEvidenceHash,
    scores,
    blockers,
    recommendedAction: deriveRecommendedAction(blockers, scores, input.publishGatePassed),
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
  };
}

/** Creates a proposal only. It cannot transition a content row or publish. */
export function createBlogContentImprovementProposalV4(
  input: BlogContentImprovementProposalInputV4,
): BlogContentImprovementProposalV4 {
  const proposalId = requireNonEmpty(input.proposalId, 'proposal_id');
  const candidateId = requireNonEmpty(input.candidateId, 'candidate_id');
  const baseContentVersion = requireNonEmpty(input.baseContentVersion, 'base_content_version');
  const targetContentVersion = requireNonEmpty(input.targetContentVersion, 'target_content_version');
  const rollbackRef = requireNonEmpty(input.rollbackRef, 'rollback_ref');
  const reasonCodes = uniqueStrings(input.reasonCodes);
  const evidenceRefs = uniqueStrings(input.evidenceRefs);
  if (reasonCodes.length === 0) throw new Error('blog_quality_v4_missing_reason_codes');
  if (evidenceRefs.length === 0) throw new Error('blog_quality_v4_evidence_required_for_proposal');
  if (input.changes.length === 0) throw new Error('blog_quality_v4_changes_required_for_proposal');
  if (input.impact.claimsChanged && !reasonCodes.includes('factual_upgrade')) {
    throw new Error('blog_quality_v4_claim_change_requires_factual_upgrade_reason');
  }
  const publicationRisk = input.impact.claimsChanged ? 'high' : input.impact.publicSurfaceChanged ? input.impact.publicationRisk : 'none';
  return {
    schemaVersion: BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION,
    proposalId,
    candidateId,
    baseContentVersion,
    targetContentVersion,
    reasonCodes,
    changes: input.changes.map(change => ({
      ...change,
      path: requireNonEmpty(change.path, 'change_path'),
      code: requireNonEmpty(change.code, 'change_code'),
      rationale: requireNonEmpty(change.rationale, 'change_rationale'),
      beforeHash: requireNonEmpty(change.beforeHash, 'change_before_hash'),
    })),
    evidenceRefs,
    impact: { ...input.impact, publicationRisk },
    rollbackRef,
    status: 'proposed',
    proposedAt: input.proposedAt ?? new Date().toISOString(),
  };
}

export function approveBlogContentImprovementProposalV4(
  proposal: BlogContentImprovementProposalV4,
  approval: BlogImprovementApprovalV4,
): BlogContentImprovementProposalV4 {
  if (proposal.proposalId !== approval.proposalId) throw new Error('blog_quality_v4_approval_proposal_mismatch');
  if (approval.status !== 'approved') throw new Error('blog_quality_v4_approval_not_approved');
  requireNonEmpty(approval.actorId, 'approval_actor_id');
  requireNonEmpty(approval.reason, 'approval_reason');
  if (proposal.status !== 'proposed') throw new Error(`blog_quality_v4_invalid_approval_state:${proposal.status}`);
  return { ...proposal, status: 'approved', approvalLineage: { ...approval } };
}

export function canApplyBlogContentImprovementProposalV4(
  proposal: BlogContentImprovementProposalV4,
): { allowed: boolean; reason: string } {
  if (proposal.status !== 'approved') return { allowed: false, reason: 'human_approval_required' };
  if (!proposal.approvalLineage) return { allowed: false, reason: 'approval_lineage_missing' };
  if (proposal.impact.claimsChanged) return { allowed: false, reason: 'claim_change_requires_atomic_reviewed_replacement' };
  return { allowed: true, reason: 'approved_proposal_only' };
}

export function validateBlogPerformanceLearningSnapshotV4(
  snapshot: BlogPerformanceLearningSnapshotV4,
): BlogPerformanceLearningSnapshotV4 {
  if (!['7d', '28d', '56d'].includes(snapshot.window)) throw new Error('blog_quality_v4_invalid_learning_window');
  requireNonEmpty(snapshot.candidateId, 'candidate_id');
  requireNonEmpty(snapshot.cohort.intent, 'learning_intent');
  requireNonEmpty(snapshot.cohort.positionBand, 'learning_position_band');
  const values = snapshot.metrics;
  if (values.impressions < 0 || values.clicks < 0 || values.conversions < 0 || values.avgPosition !== null && values.avgPosition < 0) {
    throw new Error('blog_quality_v4_invalid_learning_metric');
  }
  if (values.ctr < 0 || values.ctr > 1) throw new Error('blog_quality_v4_invalid_learning_ctr');
  return structuredClone(snapshot);
}

export interface BlogTopicCollisionCandidateV4 {
  candidateId: string;
  title: string;
  h2s: string[];
  claimTexts: string[];
  intent: string;
  destination: string;
  audience: string;
}

export interface BlogTopicCollisionReportV4 {
  collision: boolean;
  score: number;
  sharedTokens: string[];
  reasons: string[];
}

/** Deterministic pre-generation guard for duplicate/cannibalizing topics. */
export function detectBlogTopicCollisionV4(
  candidate: BlogTopicCollisionCandidateV4,
  existing: BlogTopicCollisionCandidateV4,
): BlogTopicCollisionReportV4 {
  const candidateTokens = new Set(normalizeToken([candidate.title, ...candidate.h2s, ...candidate.claimTexts].join(' ')));
  const existingTokens = new Set(normalizeToken([existing.title, ...existing.h2s, ...existing.claimTexts].join(' ')));
  const sharedTokens = [...candidateTokens].filter(token => existingTokens.has(token));
  const unionSize = new Set([...candidateTokens, ...existingTokens]).size;
  const score = unionSize === 0 ? 0 : Math.round((sharedTokens.length / unionSize) * 10000) / 100;
  const sameScope = candidate.destination === existing.destination
    && candidate.audience === existing.audience
    && candidate.intent === existing.intent;
  const collision = sameScope && (score >= 45 || sharedTokens.length >= 8);
  const reasons = [
    ...(sameScope ? ['same_representative_scope'] : []),
    ...(score >= 45 ? ['high_semantic_token_overlap'] : []),
    ...(candidate.intent === existing.intent && candidate.destination === existing.destination ? ['same_destination_intent'] : []),
  ];
  return { collision, score, sharedTokens: sharedTokens.sort((a, b) => a.localeCompare(b, 'ko')), reasons };
}

export function buildBlogQualityRegressionReportV4(
  cases: BlogQualityRegressionCaseV4[],
  evaluatedAt = new Date().toISOString(),
): BlogQualityRegressionReportV4 {
  const passed = cases.filter(item => item.passed).length;
  return {
    schemaVersion: BLOG_QUALITY_IMPROVEMENT_V4_SCHEMA_VERSION,
    fixtureSetVersion: 'blog-quality-v4-contract-20260825',
    externalCalls: 0,
    publicMutations: 0,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases,
    ok: passed === cases.length,
    evaluatedAt,
  };
}
