import type { BlogInformationIntent, BlogInformationSourcePolicy } from './blog-information-contract';
import {
  isOfficialInformationAuthority,
  isPrimaryInformationAuthority,
  validateBlogInformationResearchBundle,
  type BlogInformationClaimType,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';

export const BLOG_INFORMATION_RESEARCH_META_KEY = 'information_research_bundle';

const MINIMUM_CLAIMS_BY_INTENT: Partial<Record<BlogInformationIntent, Partial<Record<BlogInformationClaimType, number>>>> = {
  food_budget: { price: 7 },
  monthly_weather: { climate: 3 },
  airport_transport: { price: 2, duration: 2 },
  hotel_areas: { price: 3, factual: 3 },
  family_budget: { price: 4 },
  itinerary: { duration: 2, factual: 3 },
  shopping_souvenirs: { price: 3, factual: 3 },
  currency_payment: { currency: 1, factual: 3 },
  entry_requirements: { entry_visa: 2, policy: 2 },
  travel_insurance: { insurance: 4, policy: 2 },
};

const REQUIRED_CLAIM_SEMANTICS_BY_INTENT: Partial<Record<BlogInformationIntent, Array<{
  key: string;
  pattern: RegExp;
}>>> = {
  food_budget: [
    { key: 'budget_tier', pattern: /절약/ },
    { key: 'midrange_tier', pattern: /일반|중간/ },
    { key: 'luxury_tier', pattern: /여유|고급/ },
    { key: 'breakfast', pattern: /아침/ },
    { key: 'lunch', pattern: /점심/ },
    { key: 'dinner', pattern: /저녁/ },
    { key: 'snack', pattern: /간식|커피|카페|패스트\s*푸드|길거리\s*음식/ },
  ],
};

const MAX_SOURCE_AGE_DAYS: Record<BlogInformationClaimType, number> = {
  price: 45,
  currency: 30,
  duration: 90,
  percentage: 90,
  climate: 400,
  customs: 30,
  entry_visa: 30,
  insurance: 30,
  policy: 30,
  superlative: 30,
  factual: 180,
};

export interface BlogGenerationResearchReadiness {
  passed: boolean;
  issues: string[];
  bundle: BlogInformationResearchBundle | null;
  summary: {
    sourceCount: number;
    evidenceCount: number;
    claimCount: number;
    supportedClaimCount: number;
    claimSourceCoverage: number;
    distinctNormalizedValueCount: number;
  };
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalize(value: unknown): string {
  return clean(value).normalize('NFKC').toLowerCase();
}

function isResearchBundleShape(value: unknown): value is BlogInformationResearchBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.contentKey === 'string'
    && Array.isArray(record.sources)
    && Array.isArray(record.evidence)
    && Array.isArray(record.claims);
}

export function readBlogInformationResearchBundle(meta: unknown): BlogInformationResearchBundle | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[BLOG_INFORMATION_RESEARCH_META_KEY];
  return isResearchBundleShape(value) ? value : null;
}

function sourceIsFresh(source: BlogInformationResearchBundle['sources'][number], nowMs: number): boolean {
  if (source.claimTypes.length === 0) return false;
  const retrievedAt = Date.parse(source.retrievedAt);
  if (!Number.isFinite(retrievedAt) || retrievedAt > nowMs + 5 * 60 * 1000) return false;
  const maxAgeDays = Math.min(...source.claimTypes.map((type) => MAX_SOURCE_AGE_DAYS[type] ?? 30));
  return nowMs - retrievedAt <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function sourceTypeIsAllowed(
  source: BlogInformationResearchBundle['sources'][number],
  allowedTypes: string[],
): boolean {
  if (allowedTypes.includes(source.sourceType)) return true;
  if (allowedTypes.includes('official') && isOfficialInformationAuthority(source.authorityLevel)) return true;
  if (allowedTypes.includes('official_climate_data') && source.sourceType === 'meteorological_agency') return true;
  if (allowedTypes.includes('reputable_booking_data')
    && (source.sourceType === 'reputable_price_source' || source.sourceType === 'reputable_source')) return true;
  return false;
}

export function evaluateBlogGenerationResearchReadiness(input: {
  meta: unknown;
  expectedContentKey: string;
  destination?: string | null;
  intent: BlogInformationIntent;
  locale: string;
  sourcePolicy: BlogInformationSourcePolicy;
  now?: Date;
}): BlogGenerationResearchReadiness {
  const bundle = readBlogInformationResearchBundle(input.meta);
  const issues: string[] = [];
  if (!bundle) issues.push('research_bundle_missing_or_invalid_shape');

  const emptySummary = {
    sourceCount: 0,
    evidenceCount: 0,
    claimCount: 0,
    supportedClaimCount: 0,
    claimSourceCoverage: 0,
    distinctNormalizedValueCount: 0,
  };
  if (!bundle) return { passed: false, issues, bundle: null, summary: emptySummary };

  try {
    const validation = validateBlogInformationResearchBundle(bundle);
    issues.push(...validation.issues.map((issue) => `bundle:${issue}`));
  } catch {
    issues.push('research_bundle_validation_exception');
  }

  if (clean(bundle.contentKey) !== clean(input.expectedContentKey)) issues.push('content_key_mismatch');
  const expectedDestination = normalize(input.destination);
  const expectedLocale = clean(input.locale);
  if (expectedDestination) {
    for (const evidence of bundle.evidence) {
      if (normalize(evidence.scope?.destination) !== expectedDestination) {
        issues.push(`evidence_destination_mismatch:${evidence.evidenceKey || 'unknown'}`);
      }
    }
  }
  for (const evidence of bundle.evidence) {
    if (clean(evidence.scope?.locale) !== expectedLocale) {
      issues.push(`evidence_locale_mismatch:${evidence.evidenceKey || 'unknown'}`);
    }
  }

  const nowMs = (input.now ?? new Date()).getTime();
  for (const source of bundle.sources) {
    if (source.claimTypes.length === 0) issues.push(`source_claim_types_missing:${source.sourceKey}`);
    if (!sourceTypeIsAllowed(source, input.sourcePolicy.sourceTypes)) {
      issues.push(`source_type_not_allowed:${source.sourceKey}`);
    }
    if (!sourceIsFresh(source, nowMs)) issues.push(`source_stale:${source.sourceKey}`);
  }
  if (input.sourcePolicy.primarySourcesRequired
    && !bundle.sources.some((source) => isPrimaryInformationAuthority(source.authorityLevel))) {
    issues.push('official_primary_source_required');
  }

  const evidenceKeys = new Set(bundle.evidence.map((evidence) => evidence.evidenceKey));
  const supportedClaims = bundle.claims.filter((claim) =>
    claim.evidenceKeys.length > 0 && claim.evidenceKeys.every((key) => evidenceKeys.has(key)));
  const coverage = bundle.claims.length > 0 ? supportedClaims.length / bundle.claims.length : 0;
  if (coverage < input.sourcePolicy.minimumClaimSourceCoverage) {
    issues.push(`claim_source_coverage_below_minimum:${coverage.toFixed(2)}`);
  }

  const minimums = MINIMUM_CLAIMS_BY_INTENT[input.intent] ?? { factual: 3 };
  for (const [claimType, minimum] of Object.entries(minimums)) {
    const count = supportedClaims.filter((claim) => claim.claimType === claimType).length;
    if (count < Number(minimum)) issues.push(`claim_type_below_minimum:${claimType}:${count}/${minimum}`);
  }

  const supportedClaimText = supportedClaims.map((claim) => normalize(claim.claimText)).join('\n');
  for (const semantic of REQUIRED_CLAIM_SEMANTICS_BY_INTENT[input.intent] ?? []) {
    if (!semantic.pattern.test(supportedClaimText)) {
      issues.push(`claim_semantic_coverage_missing:${input.intent}:${semantic.key}`);
    }
  }

  const distinctNormalizedValues = new Set(bundle.evidence
    .map((evidence) => normalize(evidence.scope?.normalizedValue))
    .filter(Boolean));
  if (input.sourcePolicy.exactNumbersRequireSource && distinctNormalizedValues.size < 3) {
    issues.push(`distinct_evidence_values_below_minimum:${distinctNormalizedValues.size}/3`);
  }

  return {
    passed: issues.length === 0,
    issues: [...new Set(issues)],
    bundle,
    summary: {
      sourceCount: bundle.sources.length,
      evidenceCount: bundle.evidence.length,
      claimCount: bundle.claims.length,
      supportedClaimCount: supportedClaims.length,
      claimSourceCoverage: Number(coverage.toFixed(4)),
      distinctNormalizedValueCount: distinctNormalizedValues.size,
    },
  };
}

export function buildBlogGenerationResearchPromptBlock(readiness: BlogGenerationResearchReadiness): string {
  if (!readiness.passed || !readiness.bundle) return '';
  const sourceByKey = new Map(readiness.bundle.sources.map((source) => [source.sourceKey, source]));
  return [
    '## Verified research evidence pack - mandatory factual boundary',
    '- Use only the claim sentences and exact values listed below for prices, currency, time, climate, policy, or other verifiable facts.',
    '- Copy each factual claim sentence exactly into the visible article and into the hidden claim ledger. Do not paraphrase a number-bearing claim.',
    '- You may add connective explanation and reader guidance, but never add a new number, policy, schedule, price tier, or factual superlative.',
    '- If the evidence does not cover a required section, keep the article private by recording the gap. Never fill it with an estimate.',
    '',
    '### Approved sources',
    ...readiness.bundle.sources.map((source) =>
      `- [${source.sourceKey}] ${source.publisher} | ${source.authorityLevel} | checked ${source.retrievedAt} | ${source.sourceUrl ?? source.internalIdentifier ?? 'internal source'}`),
    '',
    '### Exact evidence excerpts',
    ...readiness.bundle.evidence.map((evidence) => {
      const source = sourceByKey.get(evidence.sourceKey);
      return `- [${evidence.evidenceKey}] ${source?.publisher ?? evidence.sourceKey}: ${evidence.excerpt ?? ''}`;
    }),
    '',
    '### Approved customer-visible factual claims',
    ...readiness.bundle.claims.map((claim) =>
      `- [${claim.claimType}] ${claim.claimText} (evidence: ${claim.evidenceKeys.join(', ')})`),
  ].join('\n');
}

export function summarizeBlogGenerationResearch(readiness: BlogGenerationResearchReadiness): Record<string, unknown> {
  return {
    version: 'r18-research-first-v1',
    passed: readiness.passed,
    issues: readiness.issues.slice(0, 20),
    ...readiness.summary,
    source_keys: readiness.bundle?.sources.map((source) => source.sourceKey) ?? [],
    evidence_keys: readiness.bundle?.evidence.map((evidence) => evidence.evidenceKey) ?? [],
  };
}
