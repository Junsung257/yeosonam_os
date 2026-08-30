import {
  getBlogPublicationRampDefinition,
  parseBlogPublicationRampStage,
  type BlogPublicationRampStage,
} from './blog-publication-rollout';
import type { BlogContentArchetypeV3 } from './blog-content-brief-v3';

export const BLOG_DEEPSEEK_ORCHESTRATOR_VERSION = 'blog-deepseek-orchestrator-v4' as const;

export const BLOG_DEEPSEEK_MODELS = {
  draft: 'deepseek-v4-flash',
  rewrite: 'deepseek-v4-pro',
} as const;

export type BlogDeepSeekStage =
  | 'draft_flash'
  | 'rewrite_pro_high'
  | 'rewrite_pro_max';
export type BlogQualityRouteV4 =
  | 'approved_for_slot'
  | 'rewrite_pro_high'
  | 'rewrite_pro_max'
  | 'reresearch'
  | 'human_review'
  | 'quarantine';

export type { BlogPublicationRampStage } from './blog-publication-rollout';

export interface BlogQualityRoutingInputV4 {
  score: number;
  hardBlockers?: string[];
  failureReasons?: string[];
  /** Number of completed model calls for this candidate, including the draft. */
  completedAttempts: number;
  previousScore?: number | null;
  researchAttempts?: number;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  humanApproved?: boolean;
  /** A final DeepSeek rewrite is allowed only when both inputs are explicitly true. */
  researchValid?: boolean;
  claimLedgerValid?: boolean;
  lastStage?: BlogDeepSeekStage | null;
}

export interface BlogQualityRoutingDecisionV4 {
  route: BlogQualityRouteV4;
  nextStage: BlogDeepSeekStage | null;
  publishable: boolean;
  reasons: string[];
  /** Durable model-call budget. The final two calls are repair-only rewrites. */
  maxAttempts: 5;
}

/**
 * A low score is a repair signal, not a publication disposition. Five durable
 * calls give DeepSeek one draft, one grounded rewrite, and up to three bounded
 * repair passes before a candidate is quarantined. Factual blockers still
 * short-circuit the loop; this budget only applies to model-output weakness.
 */
export const BLOG_QUALITY_MAX_ATTEMPTS_V4 = 5 as const;

export interface BlogRewriteApprovedClaimV4 {
  claimText: string;
  claimType: string;
  riskLevel: string;
  sourceUrls?: string[];
  citationLabel?: string;
  sourceLabels?: string[];
  derived?: boolean;
}

const DEFAULT_DECISION_REWRITE_CLAIMS = 6;
const MAX_DECISION_REWRITE_CLAIMS = 8;

function isDecorativePhysicalDimensionClaimV4(
  claim: BlogRewriteApprovedClaimV4,
): boolean {
  const text = claim.claimText.normalize('NFKC').toLowerCase();
  const explicitlyPhysical = /(?:높이|길이|동상|해발|고도|면적|규모|폭|최고\s*지점|최고봉|height|length|statue|altitude|area|wide|tall|long)/i.test(text);
  if (explicitlyPhysical) return true;

  const metric = /\d+(?:\.\d+)?\s*(?:km|㎞|킬로미터|m|미터)\b/i.test(text);
  if (!metric || claim.claimType !== 'factual') return false;
  const routeRelation = /(?:에서|부터).{0,100}(?:까지|거리|차량|차로|이동|소요|떨어져)|(?:from|between).{0,100}(?:to|drive|travel|away)/i.test(text);
  const operationalUse = /예약|입장|계단|엘리베이터|출입|통제|운휴|폐쇄|휴무|운영|reservation|admission|steps?|elevator|restricted|closed|hours?/i.test(text);
  return !routeRelation && !operationalUse;
}

function rewriteDecisionTokens(value: string): string[] {
  return [...new Set(value
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

function rewriteClaimDecisionScore(
  claim: BlogRewriteApprovedClaimV4,
  decisionText: string,
  decisionTokens: string[],
): number {
  const text = claim.claimText.normalize('NFKC').toLowerCase();
  let score = decisionTokens.reduce(
    (sum, token) => sum + (text.includes(token) ? 1 : 0),
    0,
  );
  const itineraryOrRoute = /일정|코스|동선|이동|교통|route|itinerary/i.test(decisionText);
  if (itineraryOrRoute) {
    if (claim.claimType === 'duration') score += 10;
    if (/주말|평일|오전|오후|저녁|밤|시\b|전(?:에|까지)|후(?:에|부터)|weekend|before|after|\d{1,2}:\d{2}/i.test(text)) score += 14;
    if (/예약|입장|계단|엘리베이터|출입|통제|운휴|폐쇄|휴무|reservation|admission|steps?|elevator|restricted|closed/i.test(text)) score += 12;
    if (/거리|차로|차량|도시에서|시내에서|에서\s*.+(?:분|시간)|drive|from\s+.+(?:minutes?|hours?)/i.test(text)) score += 8;
    // A landmark's physical dimensions are valid facts, but they rarely help
    // a reader execute an itinerary. Keep them behind schedule and movement
    // evidence unless the query explicitly asks for size or height.
    if (!/높이|길이|크기|규모|height|length|tall|long/i.test(decisionText)
      && /높이|동상|다리의?\s*길이|면적|규모|height|statue|bridge\s+is\s+\d|length/i.test(text)) {
      score -= 12;
    }
  }
  // The public article is Korean. When equivalent translated claims share the
  // same source and measurement, prefer the Korean approved sentence so the
  // model does not need to paraphrase it and invalidate the ledger fingerprint.
  if (/[가-힣]/u.test(claim.claimText)) score += 2;
  return score;
}

function rewriteClaimDecisionKey(claim: BlogRewriteApprovedClaimV4, index: number): string {
  const source = claim.sourceUrls?.[0]?.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() || '';
  const measurements = [...claim.claimText.normalize('NFKC').toLowerCase().matchAll(
    /\d+(?:\.\d+)?\s*(?:minutes?|hours?|metres?|meters?|분|시간|시|km|mm|미터|m|%|℃|°c)/g,
  )].map((match) => match[0]
    .replace(/\s+/g, '')
    .replace(/minutes?/, '분')
    .replace(/hours?/, '시간')
    .replace(/metres?|meters?|미터/, 'm')).join('|');
  return source && measurements
    ? `${source}|${claim.claimType}|${measurements}`
    : `claim:${index}`;
}

/**
 * Keep rewrites grounded without turning every research row into a separate
 * section. A genuinely month-by-month climate assignment may use all twelve
 * approved rows; other intents receive a deterministic, decision-relevant
 * subset capped at eight for route/itinerary decisions and six otherwise.
 */
export function selectDecisionRelevantRewriteClaimsV4(input: {
  primaryQuery: string;
  primaryDecision: string;
  approvedClaims: BlogRewriteApprovedClaimV4[];
  maxClaims?: number;
}): BlogRewriteApprovedClaimV4[] {
  const decisionText = `${input.primaryQuery} ${input.primaryDecision}`;
  const itineraryOrRoute = /일정|코스|동선|이동|교통|route|itinerary/i.test(input.primaryQuery);
  const asksForPhysicalDimension = /높이|길이|크기|규모|면적|고도|height|length|size|altitude/i.test(decisionText);
  const nonDimensionClaims = input.approvedClaims.filter(
    (claim) => !isDecorativePhysicalDimensionClaimV4(claim),
  );
  const claims = itineraryOrRoute && !asksForPhysicalDimension && nonDimensionClaims.length >= 3
    ? nonDimensionClaims
    : input.approvedClaims;
  const isCompleteMonthlyClimateAssignment = /(?:월별|12\s*개월)/i.test(input.primaryQuery)
    && claims.length <= 12
    && claims.every((claim) => claim.claimType === 'climate');
  if (isCompleteMonthlyClimateAssignment) return claims;

  const defaultLimit = itineraryOrRoute
    ? MAX_DECISION_REWRITE_CLAIMS
    : DEFAULT_DECISION_REWRITE_CLAIMS;
  const limit = Math.max(1, Math.min(input.maxClaims ?? defaultLimit, MAX_DECISION_REWRITE_CLAIMS));
  const decisionTokens = rewriteDecisionTokens(decisionText);
  const scored = claims.map((claim, index) => ({
    claim,
    index,
    score: rewriteClaimDecisionScore(claim, decisionText, decisionTokens),
  }));
  const selected: typeof scored = [];
  const selectedKeys = new Set<string>();
  for (const entry of [...scored].sort((left, right) => right.score - left.score || left.index - right.index)) {
    if (selected.length >= limit) break;
    const key = rewriteClaimDecisionKey(entry.claim, entry.index);
    if (selectedKeys.has(key)) continue;
    selected.push(entry);
    selectedKeys.add(key);
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.claim);
}

const RESEARCH_BLOCKERS = new Set([
  'claim_conflict_present',
  'conflicting_claim',
  'invalid_claim_ledger',
  'missing_evidence',
  'stale_claim',
  'stale_claim_present',
  'verified_demand_signal_missing',
  'unsupported_number',
  'unsupported_numeric_claim',
  'unsupported_first_party_claim',
  'false_experience_claim',
  'source_quality_failed',
]);

const NON_REWRITABLE_BLOCKERS = new Set([
  'competitor_phrase_overlap',
  'korean_language_integrity',
  'numeric_part_title_suffix',
  'stale_etias_2025_or_7_euro',
  'template_saturation',
  'title_skeleton_saturated',
]);

const RESEARCH_BLOCKER_PATTERNS = [
  /claim_conflict/,
  /conflicting_claim/,
  /invalid_claim_ledger/,
  /missing_(?:evidence|source)/,
  /stale_claim/,
  /unsupported_(?:number|numeric|claim|first_party)/,
  /false_(?:experience|verification)/,
  /fabricated_(?:experience|verification)/,
  /source_quality/,
  /factual_support/,
];

// These failures describe a model-output mismatch against an otherwise valid
// persisted research packet. After one real re-research pass, a final bounded
// rewrite may delete or exactly copy the approved claims; it still cannot
// publish unless the claim gate is completely clean on the next evaluation.
const OUTPUT_GROUNDING_REWRITE_PATTERNS = [
  /^unsupported_number(?:_present)?$/,
  /^unsupported_numeric_claim$/,
  /^invalid_claim_ledger$/,
  /^claim_ledger_body_mismatch$/,
  /^claim_support_coverage_below_/,
  /^factual_support/,
];

const EXPRESSION_OR_STRUCTURE_PATTERNS = [
  /intent/,
  /decision/,
  /concrete_itinerary/,
  /section/,
  /structure/,
  /opening/,
  /title_snippet/,
  /description/,
  /readability/,
  /editorial/,
  /paragraph/,
  /heading/,
  /internal_link/,
  /cta/,
  /query_cluster/,
  /information_gain/,
  /actionability/,
  /public_customer:(?:primary_decision|opening|paragraph|heading|cta|internal_link)/,
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isResearchBlocker(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return RESEARCH_BLOCKERS.has(normalized)
    || RESEARCH_BLOCKER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isExpressionOrStructureFailure(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return EXPRESSION_OR_STRUCTURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isOutputGroundingRewriteFailure(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return OUTPUT_GROUNDING_REWRITE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveBlogGenerationModelV4(
  stage: BlogDeepSeekStage,
): {
  provider: 'deepseek';
  model: string;
  deepseekThinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
} {
  if (stage === 'draft_flash') {
    return { provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.draft, deepseekThinking: 'disabled' };
  }
  if (stage === 'rewrite_pro_high') {
    return {
      provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.rewrite,
      // A complete article plus its hidden claim ledger must fit in one
      // response. DeepSeek counts reasoning tokens inside max_tokens; a real
      // production call exhausted all 8,192 tokens in reasoning and returned
      // an empty article. Pro remains the rewrite model, but bounded editorial
      // rewrites run in non-thinking mode so the budget is reserved for the
      // customer-visible document.
      deepseekThinking: 'disabled',
    };
  }
  if (stage === 'rewrite_pro_max') {
    return {
      provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.rewrite,
      deepseekThinking: 'disabled',
    };
  }
  return {
    provider: 'deepseek', model: BLOG_DEEPSEEK_MODELS.rewrite,
    deepseekThinking: 'disabled',
  };
}

export function decideBlogQualityRouteV4(
  input: BlogQualityRoutingInputV4,
): BlogQualityRoutingDecisionV4 {
  const hardBlockers = unique(input.hardBlockers ?? []);
  const failures = unique(input.failureReasons ?? []);
  const allReasons = unique([...hardBlockers, ...failures]);
  const completedAttempts = Math.max(1, Math.trunc(input.completedAttempts));
  const score = Number.isFinite(input.score) ? Math.max(0, Math.min(100, input.score)) : 0;

  if (input.riskLevel === 'HIGH' && !input.humanApproved) {
    return {
      route: 'human_review', nextStage: null, publishable: false,
      reasons: unique(['high_risk_human_approval_required', ...allReasons]), maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  // People-first editorial failures receive one bounded rewrite only. A
  // second writer attempt that still cannot answer the reader or pass the
  // independent judge is quarantined instead of consuming the five-call
  // factual repair budget and converging on template prose.
  const editorialHarnessFailed = allReasons.some((reason) =>
    reason.trim().toLowerCase().startsWith('editorial_harness_v5:'));
  if (editorialHarnessFailed) {
    const retry = completedAttempts < 2;
    return {
      route: retry ? 'rewrite_pro_high' : 'quarantine',
      nextStage: retry ? 'rewrite_pro_high' : null,
      publishable: false,
      reasons: unique([
        retry ? 'editorial_harness_single_rewrite' : 'editorial_harness_retry_exhausted',
        ...allReasons,
      ]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  const researchBlocked = allReasons.some(isResearchBlocker);
  if (researchBlocked) {
    const canResearchAgain = (input.researchAttempts ?? 0) < 1 && completedAttempts < BLOG_QUALITY_MAX_ATTEMPTS_V4;
    const researchReasons = allReasons.filter(isResearchBlocker);
    const canUseFinalGroundedRewrite = !canResearchAgain
      && completedAttempts >= 2
      && input.researchValid === true
      && input.lastStage === 'rewrite_pro_high'
      && researchReasons.length > 0
      && researchReasons.every(isOutputGroundingRewriteFailure)
      && !hardBlockers.some((reason) => NON_REWRITABLE_BLOCKERS.has(reason));
    const canRepairGroundedOutput = input.researchValid === true
      && input.claimLedgerValid === true
      && researchReasons.length > 0
      && researchReasons.every(isOutputGroundingRewriteFailure)
      && !hardBlockers.some((reason) => NON_REWRITABLE_BLOCKERS.has(reason));
    return {
      route: canResearchAgain
        ? 'reresearch'
        : canUseFinalGroundedRewrite || (canRepairGroundedOutput && completedAttempts < BLOG_QUALITY_MAX_ATTEMPTS_V4)
          ? 'rewrite_pro_max'
          : 'quarantine',
      nextStage: canResearchAgain
        ? completedAttempts >= 2 ? 'rewrite_pro_max' : 'rewrite_pro_high'
        : canUseFinalGroundedRewrite || (canRepairGroundedOutput && completedAttempts < BLOG_QUALITY_MAX_ATTEMPTS_V4)
          ? 'rewrite_pro_max'
          : null,
      publishable: false,
      reasons: unique([
        ...(canUseFinalGroundedRewrite ? ['final_grounded_output_rewrite'] : []),
        ...allReasons,
      ]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  if (hardBlockers.some((reason) => NON_REWRITABLE_BLOCKERS.has(reason))) {
    return {
      route: 'quarantine', nextStage: null, publishable: false,
      reasons: hardBlockers, maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  if (score >= 90 && hardBlockers.length === 0 && failures.length === 0) {
    return {
      route: 'approved_for_slot', nextStage: null, publishable: true,
      reasons: ['quality_score_at_least_90'], maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  if (completedAttempts >= BLOG_QUALITY_MAX_ATTEMPTS_V4) {
    return {
      route: 'quarantine', nextStage: null, publishable: false,
      reasons: unique(['model_attempt_limit_reached', ...allReasons]), maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  if (score >= 75 && completedAttempts >= 2) {
    const improvement = input.previousScore == null ? null : score - input.previousScore;
    return {
      route: 'rewrite_pro_max',
      nextStage: 'rewrite_pro_max',
      publishable: false,
      reasons: unique([
        'final_rewrite_attempt',
        ...(improvement != null && improvement < 5 ? ['rewrite_not_converging_observed'] : []),
        ...allReasons,
      ]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  if (score >= 75) {
    return {
      route: completedAttempts >= 3 ? 'rewrite_pro_max' : 'rewrite_pro_high',
      nextStage: completedAttempts >= 3 ? 'rewrite_pro_max' : 'rewrite_pro_high',
      publishable: false,
      reasons: unique([
        completedAttempts >= 3 ? 'repair_pass_after_initial_rewrite' : 'quality_score_75_to_89',
        ...allReasons,
      ]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  const explicitlyGrounded = input.researchValid === true && input.claimLedgerValid === true;
  const expressionOnly = allReasons.length > 0 && allReasons.every(isExpressionOrStructureFailure);
  if (explicitlyGrounded && expressionOnly) {
    return {
      route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max', publishable: false,
      reasons: unique(['quality_score_below_75_expression_or_structure_only', ...allReasons]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
    };
  }

  return {
    route: 'quarantine', nextStage: null, publishable: false,
    reasons: unique([
      'quality_score_below_75_not_rescue_eligible',
      ...(!explicitlyGrounded ? ['research_or_claim_ledger_not_valid'] : []),
      ...(!expressionOnly ? ['failure_not_expression_or_structure_only'] : []),
      ...allReasons,
    ]),
      maxAttempts: BLOG_QUALITY_MAX_ATTEMPTS_V4,
  };
}

const PRICE_CHANGE_AT = Date.parse('2026-08-16T16:00:00.000Z');
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type DeepSeekPriceTier = 'legacy' | 'peak' | 'offpeak';

export interface DeepSeekTokenPriceV4 {
  version: string;
  tier: DeepSeekPriceTier;
  cacheHitUsdPerMillion: number;
  cacheMissUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface DeepSeekUsageV4 {
  inputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  outputTokens: number;
}

export interface DeepSeekCostReceiptV4 extends DeepSeekUsageV4 {
  pricing: DeepSeekTokenPriceV4;
  estimatedCostUsd: number;
}

/** Official UTC peak windows: 01:00-04:00 and 06:00-10:00, effective 2026-08-16 16:00 UTC. */
export function isDeepSeekPeakAt(now: Date): boolean {
  if (now.getTime() < PRICE_CHANGE_AT) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600);
}

export function isDeepSeekOffPeakAt(now: Date): boolean {
  return now.getTime() >= PRICE_CHANGE_AT && !isDeepSeekPeakAt(now);
}

export function resolveDeepSeekPriceV4(model: string, now = new Date()): DeepSeekTokenPriceV4 {
  const isFlash = model === BLOG_DEEPSEEK_MODELS.draft;
  const isPro = model === BLOG_DEEPSEEK_MODELS.rewrite;
  if (!isFlash && !isPro) throw new Error(`unsupported_deepseek_pricing_model:${model}`);

  if (now.getTime() < PRICE_CHANGE_AT) {
    return isFlash
      ? { version: 'deepseek-2026-08-pre-transition', tier: 'legacy', cacheHitUsdPerMillion: 0.0028, cacheMissUsdPerMillion: 0.14, outputUsdPerMillion: 0.28 }
      : { version: 'deepseek-2026-08-pre-transition', tier: 'legacy', cacheHitUsdPerMillion: 0.003625, cacheMissUsdPerMillion: 0.435, outputUsdPerMillion: 0.87 };
  }

  const offpeak = isDeepSeekOffPeakAt(now);
  if (isFlash) {
    return offpeak
      ? { version: 'deepseek-2026-08-17', tier: 'offpeak', cacheHitUsdPerMillion: 0.007, cacheMissUsdPerMillion: 0.22, outputUsdPerMillion: 0.66 }
      : { version: 'deepseek-2026-08-17', tier: 'peak', cacheHitUsdPerMillion: 0.014, cacheMissUsdPerMillion: 0.44, outputUsdPerMillion: 1.32 };
  }
  return offpeak
    ? { version: 'deepseek-2026-08-17', tier: 'offpeak', cacheHitUsdPerMillion: 0.022, cacheMissUsdPerMillion: 0.66, outputUsdPerMillion: 1.98 }
    : { version: 'deepseek-2026-08-17', tier: 'peak', cacheHitUsdPerMillion: 0.044, cacheMissUsdPerMillion: 1.32, outputUsdPerMillion: 3.96 };
}

export function calculateDeepSeekCostV4(
  model: string,
  usage: Partial<DeepSeekUsageV4>,
  now = new Date(),
): DeepSeekCostReceiptV4 {
  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
  const cacheHitInputTokens = Math.min(inputTokens, Math.max(0, Math.trunc(usage.cacheHitInputTokens ?? 0)));
  const cacheMissInputTokens = Math.max(0, Math.trunc(
    usage.cacheMissInputTokens ?? (inputTokens - cacheHitInputTokens),
  ));
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
  const pricing = resolveDeepSeekPriceV4(model, now);
  const estimatedCostUsd = (
    cacheHitInputTokens * pricing.cacheHitUsdPerMillion
    + cacheMissInputTokens * pricing.cacheMissUsdPerMillion
    + outputTokens * pricing.outputUsdPerMillion
  ) / 1_000_000;
  return {
    inputTokens, cacheHitInputTokens, cacheMissInputTokens, outputTokens, pricing,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
  };
}

export function resolveBlogPublicationRampCapV4(
  stage: string | undefined,
): { stage: BlogPublicationRampStage; cap: number } {
  const resolvedStage = parseBlogPublicationRampStage(stage);
  return { stage: resolvedStage, cap: getBlogPublicationRampDefinition(resolvedStage).dailyCap };
}

/** The overnight KST generation window is deliberately outside DeepSeek's published peak windows. */
export function isBlogGenerationWindowKstV4(now: Date, start = '01:00', end = '06:50'): boolean {
  const parse = (value: string): number => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= parse(start) && minutes < parse(end);
}

export function nextBlogPublicationSlotKstV4(
  now: Date,
  slots: string[] = ['09:00', '12:00', '15:00', '18:00', '21:00'],
): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayStartUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  const parsed = slots
    .map((slot) => slot.match(/^(\d{2}):(\d{2})$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((minutes) => minutes >= 0 && minutes < 24 * 60)
    .sort((left, right) => left - right);
  const candidates = parsed.length ? parsed : [9 * 60];
  for (const minutes of candidates) {
    const candidate = dayStartUtcMs + minutes * 60_000;
    if (candidate > now.getTime()) return new Date(candidate).toISOString();
  }
  return new Date(dayStartUtcMs + 24 * 60 * 60_000 + candidates[0] * 60_000).toISOString();
}

function buildRewriteArchetypeContractV4(
  archetype: BlogContentArchetypeV3,
  primaryQuery: string,
): string[] {
  if (archetype === 'itinerary_timeline') {
    const requestedDuration = primaryQuery.match(/(?:^|\s)(\d{1,2})\s*박\s*(\d{1,2})\s*일/u);
    const dayBlockRule = requestedDuration
      ? `- The query asks for ${requestedDuration[1]}박${requestedDuration[2]}일. Output exactly one separate H2 for every day using "## 1일차: ..." through "## ${requestedDuration[2]}일차: ...". Never combine days in one heading and never create another heading containing an N일차 ordinal. Every day block must name an approved-claim entity and add one distinct reader choice or action beyond its heading.`
      : '- Include at least two distinct time-block or route-option sections. Every block must name an entity already present in an approved claim.';
    return [
      '[ARCHETYPE CONTRACT — itinerary_timeline]',
      '- The first paragraph must recommend a concrete proposed schedule shape in 2-4 natural sentences, use "일정" and "동선" naturally, and name only entities already present in the approved claims.',
      '- State the decision rule plainly without forcing a stock phrase, a numeric hook, or repeated command endings.',
      '- Within the first 200 visible characters, include one concrete reader trigger: a comparison question, a choice condition, or an exact approved movement/time fact. Answer it in the same paragraph; never invent a number just to create a hook.',
      dayBlockRule,
      '- You may make an editorial proposal that places approved-claim entities into different day/time/route-option blocks. Label it as a proposed schedule, not an official route.',
      '- Two unrelated duration claims never prove proximity, compatibility, a shared origin, or that two places belong together. State only the proposed order; explain a local relationship only when an exact approved claim supports it.',
      '- Put a booking/access/operation recheck beside the one block it changes, a realistic rest decision beside one block, and one rain/closure/delay fallback that names the block it replaces or removes. A bare mention of 체력 is not a rest decision: explicitly leave rest time, drop an optional block, or shorten the proposed sequence.',
      '- In exactly one day-block body sentence, write an explicit source-neutral rest action such as "휴식 시간을 남기세요" or "체력이 부족하면 이 블록을 빼세요". The sentence itself must contain the rest/action words; a heading or a bare 체력 mention does not count.',
      '- In the fallback-section body, explicitly name 우천, 휴무, or 지연 and state which named day/place block to 빼기, 미루기, 앞당기기, or 대체하기. The fallback heading alone does not count.',
      '- Give movement evidence, operating/access evidence, rest planning, and fallback planning one distinct job each. Do not restate the same advice in the opening, blocks, and conclusion with synonyms.',
      '- Use at most one meta instruction about checking, comparing, or deciding evidence in each day block. Never repeat the skeleton "확인한 뒤/비교한 뒤 ... 결정하세요" across day blocks.',
      '- Every paragraph after the opening must add a new decision detail, a supported fact, or a distinct action. Delete summary padding that merely repeats an earlier concept.',
      '- Never use 시작/중간/마무리 as substitute itinerary stages. Never output a generic planning checklist.',
      '- Use distinct day/time/route-option sections. Mix concise prose and evidence-backed actions; do not repeat the same imperative ending in every sentence or force an unrelated fixed heading count.',
      '- Attach exact schedule or movement claims beside the step they support. Never invent a visit duration, opening time, route compatibility, or transport mode.',
      '- After the day blocks, allow only one compact unnumbered fallback section and the required internal link. Do not add a "다음 확인 순서" or summary conclusion.',
      '- Never write unsupported superlative or completion language such as "가장 안전", "최적", or "전체 동선이 완성됩니다".',
      '- Before returning, verify that the visible body (not headings) contains one explicit rest action and one explicit weather/closure/delay fallback action. If either is absent, revise before returning.',
      '- Do not merely list claims or finish with generic questions. The visible article must leave a concrete named-place sequence that can be followed.',
    ];
  }
  if (archetype === 'route_walkthrough') {
    return [
      '[ARCHETYPE CONTRACT — route_walkthrough]',
      '- The first paragraph must name the recommended decision rule and contain "동선" or "이동수단".',
      '- Organize the article as three distinct stages: departure/boarding, connection or middle segment, and arrival/alighting. Use only route/entity names already present in approved claims.',
      '- Put an exact approved time, distance, fare, or operating claim beside the segment it supports; never infer an unverified stop or duration.',
      '- Include a source-neutral official recheck and a delay, sell-out, or last-service fallback without asserting that the disruption will occur.',
      '- End with distinct reader actions, not a generic three-question block.',
    ];
  }
  if (['decision_comparison', 'neighborhood_selector', 'traveler_type_plan', 'budget_scenarios'].includes(archetype)) {
    return [
      `[ARCHETYPE CONTRACT — ${archetype}]`,
      '- State the recommended selection rule in the first paragraph, then group evidence by meaningful choice rather than by source or claim.',
      '- Name only options already present in approved claims. Explain what the reader should compare without inventing an advantage, price, duration, or traveler fit.',
      '- End with a concise choice summary, not generic questions.',
    ];
  }
  if (archetype === 'current_change_explainer') {
    return [
      '[ARCHETYPE CONTRACT — current_change_explainer]',
      '- Separate the verified current state, affected reader, and required next action. Do not infer an effective date or eligibility condition.',
      '- HIGH-risk facts still require human approval; this rewrite contract never waives that gate.',
    ];
  }
  if (archetype === 'seasonal_calendar') {
    return [
      '[ARCHETYPE CONTRACT — seasonal_calendar]',
      '- Group exact climate claims into useful season choices. Do not force a twelve-month table unless all twelve approved rows are supplied.',
      '- Give an evidence-bounded travel-timing choice and a final official recheck action.',
    ];
  }
  return [
    `[ARCHETYPE CONTRACT — ${archetype}]`,
    `- Answer "${primaryQuery}" directly, group evidence by the reader's decision, and end with one concrete next action.`,
    '- Do not append a generic FAQ, checklist, or three-question closing unless the fixed assignment explicitly allows it.',
  ];
}

export function buildDeepSeekRewritePromptV4(input: {
  originalDraft: string;
  failureEvidence: string[];
  researchFingerprint: string;
  claimFingerprint: string;
  evidencePacket?: {
    fixedTitle: string;
    primaryQuery: string;
    primaryDecision: string;
    archetype: BlogContentArchetypeV3;
    sectionPurposes: string[];
    approvedClaims: BlogRewriteApprovedClaimV4[];
    officialSourceUrls: string[];
    internalLink: string;
    includeFaq: boolean;
    includeChecklist: boolean;
  };
}): string {
  const packet = input.evidencePacket;
  return [
    '[REWRITE CONTRACT — these rules override the draft]',
    '- Keep the original topic and primary decision. Answer that decision directly in the first paragraph.',
    '- The approved claims in the research packet above are the only factual source of truth.',
    '- Delete every numeric expression that does not appear verbatim in an approved claim or the supplied deterministic decision artifact. The fixed title/query duration and itinerary day-ordinal headings explicitly required below are the only other exceptions.',
    '- The visible article and hidden ledger may contain only exact approved factual claim sentences. Do not add derived factual prose.',
    '- Never infer visit duration, crowd level, waiting time, safety, opening status, or transport time.',
    '- Do not assert destination-specific rain, season, closure, fee, operating-hour, crowd, or queue facts unless an exact approved claim says so. Source-neutral planning advice to recheck an official channel or prepare a fallback is allowed.',
    '- Decision guidance may choose, group, separate, or sequence only entities already named in approved claims. Write it as an editorial reader action, never as a new property of a place.',
    '- Add no new fact, number, source, experience, destination, or factual recommendation. Do not expand the original topic scope.',
    '- You may reorder or rename sections only to satisfy the original brief and its section purposes.',
    '- Fix every failure listed below; remove unsupported prose instead of replacing it with a plausible claim.',
    '- Return Markdown only. Preserve exactly one hidden claim-ledger envelope at the end:',
    '<!-- INFORMATION_CLAIM_LEDGER_START',
    '{"claims":[{"claim_text":"exact factual sentence copied from the visible article","claim_type":"factual","risk_level":"MEDIUM"}]}',
    'INFORMATION_CLAIM_LEDGER_END -->',
    '- Every visible factual sentence or factual table row must be copied exactly into that ledger. Do not wrap the answer in a code fence.',
    ...(packet ? [
      '[FIXED ASSIGNMENT]',
      `- Exact title/H1: ${packet.fixedTitle}`,
      `- Primary query: ${packet.primaryQuery}`,
      `- Primary decision: ${packet.primaryDecision}`,
      `- Archetype: ${packet.archetype}`,
      '- Every non-optional section purpose must be resolved. Use approved claims for factual statements and clearly source-neutral decision guidance for planning steps that do not assert a local fact:',
      ...packet.sectionPurposes.map((purpose) => `  - ${purpose}`),
      `- FAQ: ${packet.includeFaq ? 'allowed only for evidence-backed registered questions' : 'do not include'}`,
      `- Checklist: ${packet.includeChecklist ? 'allowed only for evidence-backed actions' : 'do not include'}`,
      '- Do not create a new numeric table. A deterministic publisher may insert a decision-artifact table after this rewrite.',
      '- Selected approved claims (the complete factual universe for this rewrite; copy each whole sentence exactly):',
      ...packet.approvedClaims.flatMap((claim, index) => [
        `  ${index + 1}. ${claim.claimText}`,
        `     public source class: ${(claim.sourceLabels ?? []).join(', ') || '확인한 원문'}`,
        `     exact citation markdown: [${claim.citationLabel || '확인한 원문'}](${claim.sourceUrls?.[0] || ''})`,
        ...(claim.derived ? ['     deterministic derived claim: do not cite it as an official source and do not recalculate it.'] : []),
      ]),
      '- When an approved claim is used, copy it as its own complete sentence and put one linked citation on the next line.',
      '- The ledger must contain only the approved claim sentences actually copied into the visible article.',
      '- In the ledger, copy each selected claim label exactly: use its supplied claim_type and risk_level. Never replace duration or climate with a generic factual label.',
      `- Required internal link markdown: [${packet.primaryQuery} 글 모아보기](${packet.internalLink})`,
      '- Never emit a bare URL. Copy the exact Markdown link forms supplied above.',
      '- Use only the approved factual sentences needed to answer the section purpose. Do not organize the article as one source or one claim per section.',
      '- Each approved fact may appear only once in the visible article. Never restate, combine, summarize, or explain its number or entity-property pair in another sentence.',
      '- Never combine two approved numeric claims into one sentence. Keep every numeric claim as its supplied standalone sentence followed by its supplied citation.',
      '- Apart from those approved sentences, you may write only source-neutral editorial guidance: a direct decision answer, reasoning about the reader\'s choices, reader actions, headings, and reader-choice questions.',
      '- Editorial guidance must not assert a property of any destination, attraction, hotel, route, weather pattern, price, schedule, crowd, safety condition, or policy.',
      '- Outside an approved claim, avoid status-like wording such as 예약 가능, 운영 중, 영업, 이용 가능, or 이동 부담이 적다/크다. Ask the reader to check the latest official notice without predicting its content.',
      '- Outside an approved claim, never write evaluative local assertions such as "이동 시간이 길어/짧아", "같은 권역이다", "안전합니다", or "적합합니다". Rewrite them as a reader choice or delete them.',
      '- This prohibition applies to the description, opening, headings, prose, bullets, and closing. A heading is also a claim when it labels a local route or place as long, short, easy, difficult, close, or far.',
      '- Exact duration or distance claims do not authorize qualitative labels, comparisons, same-day grouping, or separation recommendations. Present the exact claims, then ask the reader to compare them against their own start point and pace.',
      '- Safe evidence headings describe the reader task, for example "공식 이동 시간으로 후보 비교하기". Never write headings such as "짧은 이동 구간" or "이동 시간이 긴 일정".',
      '- Write natural Korean with varied sentence shapes. Mix short explanations and actions; do not force every sentence to end in 하세요 or repeat a checklist rhythm.',
      '- Never shorten or repeat a schedule/measurement outside its exact approved sentence. Words such as 주말, 평일, 오전, 오후, 저녁, 밤, 시, 분, 시간, km, or m belong only inside an exact approved claim; the required N일차 headings are the sole structural exception.',
      '- Start with one 2-3 sentence paragraph of source-neutral reader actions that directly answers how the reader should make the decision. Do not open with a question or repeat the H1.',
      '- Group selected claims into as many decision-purpose sections as the article needs. Never create one H2 per claim or force a fixed heading count.',
      '- Put 1-4 related approved claims in each evidence section. Every selected claim must still appear exactly once with its own citation.',
      '- Add at most one distinct reader instruction or question per evidence section, not after every claim. Do not repeat a four-word Korean phrase more than twice.',
      '- Semantic repetition also fails: do not repeat the same movement, reservation, rest, or fallback advice in multiple sections with only wording changes.',
      '- Prefer direct reader actions ending in 확인하세요, 비교하세요, or 결정하세요. Do not turn those actions into a new assertion about the place.',
      '- Give every evidence-section H2 a distinct decision purpose. Do not use numbered month/entity + "공식 정보" as a repeated heading template.',
      ...buildRewriteArchetypeContractV4(packet.archetype, packet.primaryQuery),
      '- Do not write a new numeric table, route arrow, generic warning, generic FAQ, or generic checklist.',
      '- Use concise Korean paragraphs of 2-4 sentences. The visible article must be complete enough to make the primary decision; do not pad with generic travel prose.',
      '- Output order: H1, direct decision-answer paragraph, archetype-specific decision section, grouped evidence with citations, concise next action, internal link, hidden ledger.',
      '- Allowed official links (links are citations, not permission to invent claims):',
      ...packet.officialSourceUrls.map((url) => `  - ${url}`),
      `- Required relevant internal link: ${packet.internalLink}`,
      '- Before returning, inspect every digit-bearing sentence. It must be an exact approved claim, the fixed H1/query duration, or a required N일차 heading; otherwise delete it.',
    ] : []),
    `Research identity only (not evidence): ${input.researchFingerprint}`,
    `Claim-set identity only (not evidence): ${input.claimFingerprint}`,
    'Failures to fix:',
    ...input.failureEvidence.map((failure) => `- ${failure}`),
    ...(packet
      ? ['The previous draft is intentionally omitted because its unsupported statements are untrusted.']
      : ['Original draft to rewrite:', input.originalDraft]),
  ].join('\n');
}

/**
 * Food-budget rewrites often converge on the same generic opening even after
 * the factual body is grounded. Replace only a number-free, claim-free opening
 * with a source-domain-specific reader action. Any opening that contains an
 * approved claim or a numeric expression remains untouched.
 */
export function repairFoodBudgetRewriteOpeningV4(input: {
  markdown: string;
  primaryQuery: string;
  intentType: string;
  approvedClaims: BlogRewriteApprovedClaimV4[];
}): string {
  // Compatibility no-op. V5 inserts a deterministic decision artifact and
  // must never expose source domains in customer-facing prose.
  void input.primaryQuery;
  void input.intentType;
  void input.approvedClaims;
  return input.markdown;
}

/** Safe Markdown normalization: the writer sometimes returns the fixed H1 as plain text. */
export function normalizeBlogWriterHeadingV4(markdown: string, fixedTitle: string): string {
  const title = fixedTitle.trim();
  if (!title) return markdown.trim();
  const lines = markdown.trim().split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return '';
  if (lines[firstContentIndex]!.trim() === title) {
    lines[firstContentIndex] = `# ${title}`;
  }
  return lines.join('\n').trim();
}
