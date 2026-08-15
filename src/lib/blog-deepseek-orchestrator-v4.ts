export const BLOG_DEEPSEEK_ORCHESTRATOR_VERSION = 'blog-deepseek-orchestrator-v4' as const;

export const BLOG_DEEPSEEK_MODELS = {
  draft: 'deepseek-v4-flash',
  rewrite: 'deepseek-v4-pro',
} as const;

export type BlogDeepSeekStage = 'draft_flash' | 'rewrite_pro_high' | 'rewrite_pro_max';
export type BlogQualityRouteV4 =
  | 'approved_for_slot'
  | 'rewrite_pro_high'
  | 'rewrite_pro_max'
  | 'reresearch'
  | 'human_review'
  | 'quarantine';

export type BlogPublicationRampStage = 'pilot_3' | 'ramp_5' | 'ramp_10' | 'max_20';

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
}

export interface BlogQualityRoutingDecisionV4 {
  route: BlogQualityRouteV4;
  nextStage: BlogDeepSeekStage | null;
  publishable: boolean;
  reasons: string[];
  maxAttempts: 3;
}

const RESEARCH_BLOCKERS = new Set([
  'claim_conflict_present',
  'conflicting_claim',
  'invalid_claim_ledger',
  'missing_evidence',
  'stale_claim',
  'stale_claim_present',
  'verified_demand_signal_missing',
]);

const NON_REWRITABLE_BLOCKERS = new Set([
  'competitor_phrase_overlap',
  'korean_language_integrity',
  'numeric_part_title_suffix',
  'stale_etias_2025_or_7_euro',
  'template_saturation',
  'title_skeleton_saturated',
  'unsupported_first_party_claim',
]);

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
      reasons: unique(['high_risk_human_approval_required', ...allReasons]), maxAttempts: 3,
    };
  }

  const researchBlocked = allReasons.some((reason) => RESEARCH_BLOCKERS.has(reason));
  if (researchBlocked) {
    const canResearchAgain = (input.researchAttempts ?? 0) < 1 && completedAttempts < 3;
    return {
      route: canResearchAgain ? 'reresearch' : 'quarantine',
      nextStage: null,
      publishable: false,
      reasons: allReasons,
      maxAttempts: 3,
    };
  }

  if (hardBlockers.some((reason) => NON_REWRITABLE_BLOCKERS.has(reason))) {
    return {
      route: 'quarantine', nextStage: null, publishable: false,
      reasons: hardBlockers, maxAttempts: 3,
    };
  }

  if (score >= 90 && hardBlockers.length === 0 && failures.length === 0) {
    return {
      route: 'approved_for_slot', nextStage: null, publishable: true,
      reasons: ['quality_score_at_least_90'], maxAttempts: 3,
    };
  }

  if (completedAttempts >= 3) {
    return {
      route: 'quarantine', nextStage: null, publishable: false,
      reasons: unique(['model_attempt_limit_reached', ...allReasons]), maxAttempts: 3,
    };
  }

  if (completedAttempts >= 2) {
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
      maxAttempts: 3,
    };
  }

  const nextStage: BlogDeepSeekStage = score >= 75 ? 'rewrite_pro_high' : 'rewrite_pro_max';
  return {
    route: nextStage,
    nextStage,
    publishable: false,
    reasons: unique([score >= 75 ? 'quality_score_75_to_89' : 'quality_score_below_75', ...allReasons]),
    maxAttempts: 3,
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
  switch (stage) {
    case 'ramp_5': return { stage, cap: 5 };
    case 'ramp_10': return { stage, cap: 10 };
    case 'max_20': return { stage, cap: 20 };
    default: return { stage: 'pilot_3', cap: 3 };
  }
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

export function buildDeepSeekRewritePromptV4(input: {
  originalDraft: string;
  failureEvidence: string[];
  researchFingerprint: string;
  claimFingerprint: string;
  evidencePacket?: {
    fixedTitle: string;
    primaryQuery: string;
    primaryDecision: string;
    sectionPurposes: string[];
    approvedClaims: Array<{
      claimText: string;
      claimType: string;
      riskLevel: string;
      sourceUrls?: string[];
    }>;
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
    '- Delete every numeric expression that does not appear verbatim in an approved claim. Do not estimate or calculate.',
    '- The visible article and hidden ledger may contain only exact approved factual claim sentences. Do not add derived factual prose.',
    '- Never infer visit duration, crowd level, route compatibility, waiting time, safety, opening status, or transport time.',
    '- Do not mention rain, seasons, closures, fees, operating hours, crowds, queues, or route pairings unless an exact approved claim says so.',
    '- Decision guidance must be framed as a reader choice or question. It must not introduce a new property of a place.',
    '- Add no new fact, number, source, experience, destination, or recommendation. Do not expand the original topic scope.',
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
      '- Section purposes are optional and may be omitted when the approved claims cannot support them:',
      ...packet.sectionPurposes.map((purpose) => `  - ${purpose}`),
      `- FAQ: ${packet.includeFaq ? 'allowed only for evidence-backed registered questions' : 'do not include'}`,
      `- Checklist: ${packet.includeChecklist ? 'allowed only for evidence-backed actions' : 'do not include'}`,
      '- Do not use a table in this rewrite. Tables encourage unsupported values and implied comparisons.',
      '- Approved claims (the complete factual universe; copy a whole sentence exactly when used):',
      ...packet.approvedClaims.flatMap((claim, index) => [
        `  ${index + 1}. [${claim.claimType}/${claim.riskLevel}] ${claim.claimText}`,
        `     exact citation markdown: [공식 근거](${claim.sourceUrls?.[0] || ''})`,
      ]),
      '- When an approved claim is used, copy it as its own complete sentence and put one linked citation on the next line.',
      '- The ledger must contain only the approved claim sentences actually copied into the visible article.',
      `- Required internal link markdown: [${packet.primaryQuery} 글 모아보기](${packet.internalLink})`,
      '- Never emit a bare URL. Copy the exact Markdown link forms supplied above.',
      `- Use exactly ${packet.approvedClaims.length} factual sentences: each approved claim once. Do not omit or paraphrase them.`,
      '- Apart from those approved sentences, write only headings and reader-choice questions ending in a question mark.',
      '- Do not write a table, itinerary, route arrow, warning, FAQ, checklist, recommendation, or generic freshness warning.',
      '- Output order: H1, one decision-guidance opening, one short section per approved claim with its citation, reader-choice questions, internal link, hidden ledger.',
      '- Allowed official links (links are citations, not permission to invent claims):',
      ...packet.officialSourceUrls.map((url) => `  - ${url}`),
      `- Required relevant internal link: ${packet.internalLink}`,
      '- Before returning, inspect every digit-bearing sentence. It must be an exact approved claim or be deleted.',
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
