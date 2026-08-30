import { createHash } from 'node:crypto';

export const BLOG_INFORMATION_SOURCE_TYPES = [
  'government',
  'embassy',
  'immigration',
  'customs',
  'meteorological_agency',
  'airport',
  'transport_operator',
  'insurer_policy',
  'regulator',
  'central_bank',
  'bank',
  'official_tourism',
  'official_map',
  'official_operator',
  'field_research',
  'reputable_local_source',
  'reputable_price_source',
  'reputable_source',
  'legal_review',
  'internal_reference',
] as const;

export const BLOG_INFORMATION_CLAIM_TYPES = [
  'price',
  'currency',
  'duration',
  'percentage',
  'climate',
  'customs',
  'entry_visa',
  'insurance',
  'policy',
  'superlative',
  'factual',
] as const;

export const BLOG_INFORMATION_AUTHORITY_LEVELS = [
  'official_primary',
  'official_secondary',
  'editorial_secondary',
  'field_observation',
  'internal_reference',
] as const;

export type BlogInformationSourceType = (typeof BLOG_INFORMATION_SOURCE_TYPES)[number];
export type BlogInformationClaimType = (typeof BLOG_INFORMATION_CLAIM_TYPES)[number];
export type BlogInformationAuthorityLevel = (typeof BLOG_INFORMATION_AUTHORITY_LEVELS)[number];
export type BlogInformationEvidenceRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BlogInformationExtractedValue {
  normalizedValue: string;
  unit: string | null;
  currency: string | null;
  /** Deterministic arithmetic provenance. Model-written formulas are never trusted. */
  derivation?: {
    version: 'blog-claim-derivation-v1';
    operation: 'sum';
    operandClaimFingerprints: string[];
    operandValues: string[];
    formula: string;
    assumptions: string[];
  };
}

export interface BlogInformationEvidenceScope {
  country: string;
  destination: string;
  applicableTo: string;
  locale: string;
  claimType: BlogInformationClaimType;
  normalizedValue: string;
  unit: string | null;
  currency: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  verifiedAt?: string | null;
  nextReviewAt?: string | null;
  conditions: string[];
}

export interface BlogInformationSourceInput {
  sourceKey: string;
  sourceType: BlogInformationSourceType;
  authorityLevel: BlogInformationAuthorityLevel;
  sourceUrl?: string | null;
  internalIdentifier?: string | null;
  publisher: string;
  retrievedAt: string;
  snapshotContent: string;
  contentHash: string;
  validFrom?: string | null;
  validUntil?: string | null;
  destination?: string | null;
  country?: string | null;
  claimTypes: BlogInformationClaimType[];
  riskLevel: BlogInformationEvidenceRiskLevel;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BlogInformationEvidenceInput {
  evidenceKey: string;
  sourceKey: string;
  sourceLocator?: string | null;
  excerpt?: string | null;
  spanStart: number;
  spanEnd: number;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
  observedAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  scope: BlogInformationEvidenceScope;
  capturedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface BlogInformationClaimInput {
  claimFingerprint: string;
  claimText: string;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
  extractedValue?: BlogInformationExtractedValue;
  requiresEvidence: boolean;
  evidenceKeys: string[];
}

export interface BlogInformationResearchBundle {
  contentKey: string;
  creativeId?: string | null;
  tenantId?: string | null;
  siteScope?: string | null;
  sources: BlogInformationSourceInput[];
  evidence: BlogInformationEvidenceInput[];
  claims: BlogInformationClaimInput[];
}

export interface BlogInformationResearchBundleValidation {
  passed: boolean;
  issues: string[];
}

export interface BlogInformationClaimLiteralSupportReport {
  passed: boolean;
  numericTokens: string[];
  missingNumericTokens: string[];
}

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

const ENGLISH_NUMBER_WORDS: Array<[RegExp, string]> = [
  [/\bzero\b/gi, '0'],
  [/\bone\b/gi, '1'],
  [/\btwo\b/gi, '2'],
  [/\bthree\b/gi, '3'],
  [/\bfour\b/gi, '4'],
  [/\bfive\b/gi, '5'],
  [/\bsix\b/gi, '6'],
  [/\bseven\b/gi, '7'],
  [/\beight\b/gi, '8'],
  [/\bnine\b/gi, '9'],
  [/\bten\b/gi, '10'],
  [/\beleven\b/gi, '11'],
  [/\btwelve\b/gi, '12'],
];

function normalizeLiteralEvidence(value: string): string {
  const withoutAuditScope = value
    .split(/\[(?:검증\s*범위|verification\s*scope)\s*:/i, 1)[0]
    .normalize('NFKC')
    .toLowerCase();
  return ENGLISH_NUMBER_WORDS.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    withoutAuditScope,
  );
}

function extractLiteralNumericTokens(value: string): string[] {
  const withoutDocumentIdentifiers = normalizeLiteralEvidence(value)
    .replace(/\b(form|route|flight|model|version|iso)\s*[-:#]?\s*\d+[a-z]?\b/gi, '$1');
  return [...new Set(
    (withoutDocumentIdentifiers.match(/\d+(?:[.,]\d+)*/g) ?? [])
      .map((token) => token.replace(/,/g, '').replace(/^0+(?=\d)/, '')),
  )];
}

/**
 * A structured value can validate only one part of a compound model claim.
 * Require every literal number in the claim to occur in its linked source
 * excerpt so an otherwise valid value cannot smuggle in a second schedule,
 * price, distance, date, or quantity.
 */
export function inspectBlogInformationClaimLiteralSupport(input: {
  claimText: string;
  evidence: Array<Pick<BlogInformationEvidenceInput, 'excerpt'>>;
}): BlogInformationClaimLiteralSupportReport {
  const numericTokens = extractLiteralNumericTokens(input.claimText);
  if (numericTokens.length === 0) {
    return { passed: true, numericTokens, missingNumericTokens: [] };
  }
  const evidenceTokens = new Set(input.evidence.flatMap((item) =>
    extractLiteralNumericTokens(item.excerpt ?? '')));
  const missingNumericTokens = numericTokens.filter((token) => !evidenceTokens.has(token));
  return {
    passed: missingNumericTokens.length === 0,
    numericTokens,
    missingNumericTokens,
  };
}

export function extractMonthlyClimateCompositeValue(
  value: string,
): BlogInformationExtractedValue | null {
  const match = value.match(
    /최고기온\s*(-?\d+(?:\.\d+)?)\s*(?:℃|°C)[\s\S]*?최저기온\s*(-?\d+(?:\.\d+)?)\s*(?:℃|°C)[\s\S]*?강수량\s*(\d+(?:\.\d+)?)\s*mm[\s\S]*?강수일수\s*(\d+(?:\.\d+)?)\s*일/i,
  );
  if (!match) return null;
  return {
    normalizedValue: match.slice(1, 5).map((item) => item.replace(/,/g, '').replace(/^\+/, '').trim()).join('|'),
    unit: '월별 기후 지표',
    currency: null,
  };
}

function isIsoDate(value?: string | null): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function validWindow(from?: string | null, until?: string | null): boolean {
  if (!from || !until) return true;
  return isIsoDate(from) && isIsoDate(until) && Date.parse(until) >= Date.parse(from);
}

function isSafeSourceUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === 'metadata'
      || hostname === 'metadata.google.internal'
      || hostname === '::1'
      || /^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f:]*$/i.test(hostname)
    ) return false;
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((part) => part < 0 || part > 255)) return false;
      const [a, b] = octets;
      if (
        a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createBlogInformationClaimFingerprint(claimText: string): string {
  const normalized = clean(claimText).normalize('NFKC').toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function normalizeBlogInformationSourceSnapshot(content: string): string {
  return content.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
}

export function createBlogInformationSourceContentHash(content: string): string {
  return createHash('sha256')
    .update(normalizeBlogInformationSourceSnapshot(content), 'utf8')
    .digest('hex');
}

export function createBlogInformationSourceIdentityScopeKey(input: {
  tenantId?: string | null;
  siteScope?: string | null;
  sourceKey: string;
}): string {
  return [
    clean(input.tenantId) || 'public',
    clean(input.siteScope).toLowerCase() || 'www.yeosonam.com',
    clean(input.sourceKey).toLowerCase(),
  ].join(':');
}

export function createBlogInformationSourceVersionKey(
  source: Pick<BlogInformationSourceInput, 'sourceKey' | 'sourceUrl' | 'internalIdentifier' | 'retrievedAt' | 'contentHash' | 'snapshotContent'>,
): string {
  const material = [
    clean(source.sourceKey).toLowerCase(),
    clean(source.sourceUrl) || clean(source.internalIdentifier),
    clean(source.retrievedAt),
    clean(source.contentHash).toLowerCase(),
  ].join('\n');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export function isOfficialInformationAuthority(level: BlogInformationAuthorityLevel): boolean {
  return level === 'official_primary' || level === 'official_secondary';
}

export function isPrimaryInformationAuthority(level: BlogInformationAuthorityLevel): boolean {
  return level === 'official_primary';
}

function normalizeMeaning(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsSemanticToken(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeMeaning(haystack);
  const normalizedNeedle = normalizeMeaning(needle);
  if (!normalizedNeedle) return false;
  if (!/^[a-z0-9][a-z0-9 ._-]*$/i.test(normalizedNeedle)) {
    return normalizedHaystack.includes(normalizedNeedle);
  }
  const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(normalizedHaystack);
}

function equivalentCurrencyTokens(currency: string): string[] {
  const normalized = currency.toUpperCase();
  const aliases: Record<string, string[]> = {
    KRW: ['krw', '원', '₩', '￦'],
    JPY: ['jpy', '엔', '¥', '￥'],
    USD: ['usd', '달러', '$'],
    VND: ['vnd', '동', '₫'],
    SGD: ['sgd', '싱가포르달러', 's$'],
    EUR: ['eur', '유로', '€'],
  };
  return aliases[normalized] ?? [normalized.toLowerCase()];
}

function equivalentSemanticValueTokens(value: string): string[] {
  const normalized = normalizeMeaning(value);
  const aliases: Record<string, string[]> = {
    required: ['required', '필수', '필요', '의무'],
    not_required: ['not_required', 'not required', '불필요', '필요하지', '면제'],
    prohibited: ['prohibited', '금지', '불가', '할 수 없'],
    available: ['available', '예약 가능', '이용 가능', '운영 중'],
    unavailable: ['unavailable', '예약 불가', '마감', '매진', '휴무', '중단'],
    covered: ['covered', '보장'],
    superlative: ['superlative', '가장', '최고', '최저', '최대', '최소', '1위'],
  };
  return aliases[normalized] ?? [normalized];
}

function equivalentUnitTokens(unit: string): string[] {
  const normalized = normalizeMeaning(unit);
  const aliases: Record<string, string[]> = {
    time: [':', '시'],
    km: ['km', '㎞', '킬로미터'],
    m: [' m', '미터'],
    celsius: ['℃', '°c'],
  };
  return aliases[normalized] ?? [normalized];
}

function hasValidScopeWindow(scope: BlogInformationEvidenceScope): boolean {
  const explicitWindow = Boolean(scope.validFrom && scope.validUntil);
  const reviewWindow = Boolean(scope.verifiedAt && scope.nextReviewAt);
  if (!explicitWindow && !reviewWindow) return false;
  const start = scope.validFrom ?? scope.verifiedAt;
  const end = scope.validUntil ?? scope.nextReviewAt;
  return Boolean(start && end && isIsoDate(start) && isIsoDate(end) && Date.parse(end) >= Date.parse(start));
}

function scopeDateYears(scope: BlogInformationEvidenceScope): string[] {
  return [scope.validFrom, scope.validUntil, scope.verifiedAt, scope.nextReviewAt]
    .filter((value): value is string => Boolean(value && isIsoDate(value)))
    .map((value) => new Date(value).getUTCFullYear().toString());
}

export function validateBlogInformationEvidenceScope(
  evidence: Pick<BlogInformationEvidenceInput, 'claimType' | 'excerpt' | 'scope'>,
): string[] {
  const scope = evidence.scope;
  if (!scope || typeof scope !== 'object') return ['missing_scope'];
  const issues: string[] = [];
  if (!clean(scope.country)) issues.push('missing_country');
  if (!clean(scope.destination)) issues.push('missing_destination');
  if (!clean(scope.applicableTo)) issues.push('missing_applicable_to');
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(clean(scope.locale))) issues.push('invalid_locale');
  if (scope.claimType !== evidence.claimType) issues.push('claim_type_mismatch');
  if (!clean(scope.normalizedValue)) issues.push('missing_normalized_value');
  if (!Object.prototype.hasOwnProperty.call(scope, 'unit')) issues.push('missing_unit_field');
  if (!Object.prototype.hasOwnProperty.call(scope, 'currency')) issues.push('missing_currency_field');
  if ((evidence.claimType === 'price' || evidence.claimType === 'currency') && !clean(scope.currency)) {
    issues.push('missing_currency');
  }
  if (!Array.isArray(scope.conditions) || scope.conditions.length === 0 || scope.conditions.some((item) => !clean(item))) {
    issues.push('missing_conditions');
  }
  if (!hasValidScopeWindow(scope)) issues.push('invalid_scope_window');
  const futureToleranceMs = 5 * 60 * 1000;
  if (scope.verifiedAt && Date.parse(scope.verifiedAt) > Date.now() + futureToleranceMs) {
    issues.push('future_verified_at');
  }

  const excerpt = normalizeMeaning(evidence.excerpt);
  if (!excerpt) return [...issues, 'missing_excerpt'];
  const monthlyClimateValue = evidence.claimType === 'climate'
    && normalizeMeaning(scope.unit) === normalizeMeaning('월별 기후 지표')
    ? extractMonthlyClimateCompositeValue(evidence.excerpt ?? '')
    : null;
  if (monthlyClimateValue) {
    if (normalizeMeaning(monthlyClimateValue.normalizedValue) !== normalizeMeaning(scope.normalizedValue)) {
      issues.push('excerpt_value_mismatch');
    }
  } else {
    if (!equivalentSemanticValueTokens(scope.normalizedValue).some((token) => excerpt.includes(normalizeMeaning(token)))) {
      issues.push('excerpt_value_mismatch');
    }
    if (scope.unit && !equivalentUnitTokens(scope.unit).some((token) => excerpt.includes(normalizeMeaning(token)))) {
      issues.push('excerpt_unit_mismatch');
    }
  }
  if (scope.currency && !equivalentCurrencyTokens(scope.currency).some((token) => excerpt.includes(normalizeMeaning(token)))) {
    issues.push('excerpt_currency_mismatch');
  }
  const locations = [scope.country, scope.destination]
    .map(normalizeMeaning)
    .filter(Boolean);
  if (!locations.some((target) => excerpt.includes(target))) issues.push('excerpt_location_mismatch');
  if (!containsSemanticToken(excerpt, scope.applicableTo)) issues.push('excerpt_applicable_to_mismatch');
  const years = scopeDateYears(scope);
  if (years.length === 0 || !years.some((year) => excerpt.includes(year))) issues.push('excerpt_date_mismatch');
  return [...new Set(issues)];
}

export function blogInformationEvidenceScopeSupportsClaim(input: {
  evidence: Pick<BlogInformationEvidenceInput, 'claimType' | 'excerpt' | 'scope'>;
  claimType: BlogInformationClaimType;
  extractedValue?: BlogInformationExtractedValue;
  expectedScope?: Partial<Pick<BlogInformationEvidenceScope, 'country' | 'destination' | 'applicableTo' | 'locale'>>;
}): { passed: boolean; issues: string[] } {
  const issues = validateBlogInformationEvidenceScope(input.evidence);
  const scope = input.evidence.scope;
  if (!scope) return { passed: false, issues };
  if (scope.claimType !== input.claimType) issues.push('claim_type_mismatch');
  if (input.extractedValue) {
    const compositeParts = clean(input.extractedValue.normalizedValue).split('|');
    const supportsMonthlyClimateComponent = input.claimType === 'climate'
      && clean(input.extractedValue.unit) === '월별 기후 지표'
      && compositeParts.length === 4
      && (
        (
          clean(scope.unit) === '월별 기온 지표'
          && normalizeMeaning(scope.normalizedValue)
            === normalizeMeaning(compositeParts.slice(0, 2).join('|'))
        )
        || (
          clean(scope.unit) === '월별 강수 지표'
          && normalizeMeaning(scope.normalizedValue)
            === normalizeMeaning(compositeParts.slice(2, 4).join('|'))
        )
      );
    if (!supportsMonthlyClimateComponent
      && normalizeMeaning(scope.normalizedValue) !== normalizeMeaning(input.extractedValue.normalizedValue)) {
      issues.push('normalized_value_mismatch');
    }
    if (!supportsMonthlyClimateComponent
      && normalizeMeaning(scope.unit) !== normalizeMeaning(input.extractedValue.unit)) {
      issues.push('unit_mismatch');
    }
    if (normalizeMeaning(scope.currency) !== normalizeMeaning(input.extractedValue.currency)) issues.push('currency_mismatch');
  }
  for (const [key, value] of Object.entries(input.expectedScope ?? {})) {
    if (value && normalizeMeaning(scope[key as keyof BlogInformationEvidenceScope]) !== normalizeMeaning(value)) {
      issues.push(`${key}_mismatch`);
    }
  }
  return { passed: issues.length === 0, issues: [...new Set(issues)] };
}

export function blogInformationEvidenceSetSupportsClaim(input: {
  evidence: Array<Pick<BlogInformationEvidenceInput, 'claimType' | 'excerpt' | 'scope'>>;
  claimType: BlogInformationClaimType;
  extractedValue?: BlogInformationExtractedValue;
  expectedScope?: Partial<Pick<BlogInformationEvidenceScope, 'country' | 'destination' | 'applicableTo' | 'locale'>>;
}): { passed: boolean; issues: string[] } {
  const reports = input.evidence.map((evidence) =>
    blogInformationEvidenceScopeSupportsClaim({
      evidence,
      claimType: input.claimType,
      extractedValue: input.extractedValue,
      expectedScope: input.expectedScope,
    }));
  const compositeParts = clean(input.extractedValue?.normalizedValue).split('|');
  const isMonthlyClimateComposite = input.claimType === 'climate'
    && clean(input.extractedValue?.unit) === '월별 기후 지표'
    && compositeParts.length === 4;
  if (!isMonthlyClimateComposite) {
    return {
      passed: reports.some((report) => report.passed),
      issues: [...new Set(reports.flatMap((report) => report.issues))],
    };
  }
  const hasCompleteCompositeEvidence = input.evidence.some((evidence, index) =>
    reports[index]?.passed
    && clean(evidence.scope?.unit) === '월별 기후 지표'
    && normalizeMeaning(evidence.scope?.normalizedValue)
      === normalizeMeaning(input.extractedValue?.normalizedValue));
  if (hasCompleteCompositeEvidence) {
    return { passed: true, issues: [] };
  }

  const passedUnits = new Set(input.evidence.flatMap((evidence, index) =>
    reports[index]?.passed ? [clean(evidence.scope?.unit)] : []));
  const missingComponents = [
    ['월별 기온 지표', 'monthly_temperature'],
    ['월별 강수 지표', 'monthly_precipitation'],
  ].flatMap(([unit, issue]) => passedUnits.has(unit) ? [] : [`composite_evidence_missing:${issue}`]);
  return {
    passed: missingComponents.length === 0,
    issues: missingComponents.length > 0
      ? missingComponents
      : [],
  };
}

export function validateBlogInformationResearchBundle(
  bundle: BlogInformationResearchBundle,
): BlogInformationResearchBundleValidation {
  const issues: string[] = [];
  if (!clean(bundle.contentKey)) issues.push('missing_content_key');
  if (bundle.sources.length === 0) issues.push('missing_sources');
  if (bundle.evidence.length === 0) issues.push('missing_evidence');
  if (bundle.claims.length === 0) issues.push('missing_claims');

  const sourceKeys = new Set<string>();
  const sourceByKey = new Map<string, BlogInformationSourceInput>();
  for (const source of bundle.sources) {
    const key = clean(source.sourceKey);
    if (!key) issues.push('source:missing_source_key');
    else if (sourceKeys.has(key)) issues.push(`source:duplicate_source_key:${key}`);
    else {
      sourceKeys.add(key);
      sourceByKey.set(key, source);
    }
    if (!clean(source.publisher)) issues.push(`source:missing_publisher:${key || 'unknown'}`);
    if (!isIsoDate(source.retrievedAt)) issues.push(`source:invalid_retrieved_at:${key || 'unknown'}`);
    else if (Date.parse(source.retrievedAt) > Date.now() + 5 * 60 * 1000) {
      issues.push(`source:future_retrieved_at:${key || 'unknown'}`);
    }
    const normalizedSnapshot = normalizeBlogInformationSourceSnapshot(source.snapshotContent ?? '');
    if (!normalizedSnapshot) issues.push(`source:missing_snapshot:${key || 'unknown'}`);
    if (!/^[0-9a-f]{64}$/i.test(clean(source.contentHash))) issues.push(`source:invalid_content_hash:${key || 'unknown'}`);
    else if (source.contentHash.toLowerCase() !== createBlogInformationSourceContentHash(normalizedSnapshot)) {
      issues.push(`source:content_hash_mismatch:${key || 'unknown'}`);
    }
    const hasUrl = Boolean(clean(source.sourceUrl));
    const hasInternalIdentifier = Boolean(clean(source.internalIdentifier));
    if (!hasUrl && !hasInternalIdentifier) issues.push(`source:missing_locator:${key || 'unknown'}`);
    if (hasUrl && !isSafeSourceUrl(source.sourceUrl)) issues.push(`source:unsafe_url:${key || 'unknown'}`);
    if (!validWindow(source.validFrom, source.validUntil)) issues.push(`source:invalid_valid_window:${key || 'unknown'}`);
    if (Boolean(source.reviewerId) !== Boolean(source.reviewedAt)) {
      issues.push(`source:incomplete_review:${key || 'unknown'}`);
    }
  }

  const evidenceKeys = new Set<string>();
  const evidenceByKey = new Map<string, BlogInformationEvidenceInput>();
  for (const evidence of bundle.evidence) {
    const key = clean(evidence.evidenceKey);
    if (!key) issues.push('evidence:missing_evidence_key');
    else if (evidenceKeys.has(key)) issues.push(`evidence:duplicate_evidence_key:${key}`);
    else {
      evidenceKeys.add(key);
      evidenceByKey.set(key, evidence);
    }
    if (!sourceKeys.has(clean(evidence.sourceKey))) issues.push(`evidence:unknown_source:${key || 'unknown'}`);
    if (!isIsoDate(evidence.observedAt)) issues.push(`evidence:invalid_observed_at:${key || 'unknown'}`);
    else if (Date.parse(evidence.observedAt) > Date.now() + 5 * 60 * 1000) {
      issues.push(`evidence:future_observed_at:${key || 'unknown'}`);
    }
    if (!validWindow(evidence.validFrom, evidence.validUntil)) issues.push(`evidence:invalid_valid_window:${key || 'unknown'}`);
    for (const scopeIssue of validateBlogInformationEvidenceScope(evidence)) {
      issues.push(`evidence:scope:${scopeIssue}:${key || 'unknown'}`);
    }
    const source = sourceByKey.get(clean(evidence.sourceKey));
    if (source) {
      const snapshot = normalizeBlogInformationSourceSnapshot(source.snapshotContent ?? '');
      const snapshotCharacters = Array.from(snapshot);
      const validSpan = Number.isInteger(evidence.spanStart)
        && Number.isInteger(evidence.spanEnd)
        && evidence.spanStart >= 0
        && evidence.spanEnd > evidence.spanStart
        && evidence.spanEnd <= snapshotCharacters.length;
      if (!validSpan
        || snapshotCharacters.slice(evidence.spanStart, evidence.spanEnd).join('') !== evidence.excerpt) {
        issues.push(`evidence:snapshot_span_mismatch:${key || 'unknown'}`);
      }
    }
    if (source?.country && normalizeMeaning(source.country) !== normalizeMeaning(evidence.scope?.country)) {
      issues.push(`evidence:source_country_mismatch:${key || 'unknown'}`);
    }
    if (source?.destination && normalizeMeaning(source.destination) !== normalizeMeaning(evidence.scope?.destination)) {
      issues.push(`evidence:source_destination_mismatch:${key || 'unknown'}`);
    }
  }

  const claimFingerprints = new Set<string>();
  const claimByFingerprint = new Map(
    bundle.claims.map((claim) => [clean(claim.claimFingerprint), claim]),
  );
  for (const claim of bundle.claims) {
    const fingerprint = clean(claim.claimFingerprint);
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) issues.push('claim:invalid_fingerprint');
    else if (claimFingerprints.has(fingerprint)) issues.push(`claim:duplicate_fingerprint:${fingerprint}`);
    else claimFingerprints.add(fingerprint);
    if (!clean(claim.claimText)) issues.push(`claim:missing_text:${fingerprint || 'unknown'}`);
    if (claim.requiresEvidence && !clean(claim.extractedValue?.normalizedValue)) {
      issues.push(`claim:missing_normalized_value:${fingerprint || 'unknown'}`);
    }
    if (claim.requiresEvidence && claim.evidenceKeys.length === 0) {
      issues.push(`claim:missing_evidence:${fingerprint || 'unknown'}`);
    }
    const linkedEvidence = claim.evidenceKeys
      .map((evidenceKey) => evidenceByKey.get(clean(evidenceKey)))
      .filter((evidence): evidence is BlogInformationEvidenceInput => Boolean(evidence));
    const derivation = claim.extractedValue?.derivation;
    if (derivation) {
      const operands = derivation.operandClaimFingerprints.map((operandFingerprint) =>
        claimByFingerprint.get(clean(operandFingerprint)));
      const operandValues = derivation.operandValues.map((value) => Number(value));
      const result = Number(claim.extractedValue?.normalizedValue);
      const expectedEvidenceKeys = new Set(operands.flatMap((operand) => operand?.evidenceKeys ?? []));
      const structurallyValid = derivation.version === 'blog-claim-derivation-v1'
        && derivation.operation === 'sum'
        && operands.length >= 2
        && operands.length <= 12
        && operands.length === operandValues.length
        && operands.every((operand, index) => {
          if (!operand || operand.extractedValue?.derivation) return false;
          const operandValue = Number(operand.extractedValue?.normalizedValue);
          return Number.isFinite(operandValue)
            && Math.abs(operandValue - operandValues[index]!) < 0.005
            && (operand.extractedValue?.currency ?? '') === (claim.extractedValue?.currency ?? '');
        })
        && Number.isFinite(result)
        && Math.abs(operandValues.reduce((sum, value) => sum + value, 0) - result) < 0.005
        && claim.evidenceKeys.length > 0
        && claim.evidenceKeys.every((evidenceKey) => expectedEvidenceKeys.has(evidenceKey))
        && [...expectedEvidenceKeys].every((evidenceKey) => claim.evidenceKeys.includes(evidenceKey));
      if (!structurallyValid) {
        issues.push(`claim:invalid_derivation:${fingerprint || 'unknown'}`);
      }
      for (const evidenceKey of claim.evidenceKeys) {
        if (!evidenceKeys.has(clean(evidenceKey))) {
          issues.push(`claim:unknown_evidence:${fingerprint || 'unknown'}:${clean(evidenceKey) || 'blank'}`);
        }
      }
      continue;
    }
    const literalSupport = inspectBlogInformationClaimLiteralSupport({
      claimText: claim.claimText,
      evidence: linkedEvidence,
    });
    for (const token of literalSupport.missingNumericTokens) {
      issues.push(`claim:unsupported_numeric_token:${token}:${fingerprint || 'unknown'}`);
    }
    const setSupport = blogInformationEvidenceSetSupportsClaim({
      evidence: linkedEvidence,
      claimType: claim.claimType,
      extractedValue: claim.extractedValue,
    });
    if (!setSupport.passed) {
      for (const supportIssue of setSupport.issues) {
        issues.push(`claim:evidence_set_mismatch:${supportIssue}:${fingerprint || 'unknown'}`);
      }
    }
    for (const evidenceKey of claim.evidenceKeys) {
      if (!evidenceKeys.has(clean(evidenceKey))) {
        issues.push(`claim:unknown_evidence:${fingerprint || 'unknown'}:${clean(evidenceKey) || 'blank'}`);
        continue;
      }
      const evidence = evidenceByKey.get(clean(evidenceKey));
      const source = evidence ? sourceByKey.get(clean(evidence.sourceKey)) : null;
      if (evidence) {
        const support = blogInformationEvidenceScopeSupportsClaim({
          evidence,
          claimType: claim.claimType,
          extractedValue: claim.extractedValue,
          expectedScope: {
            country: source?.country ?? undefined,
            destination: source?.destination ?? undefined,
          },
        });
        for (const supportIssue of support.issues) {
          issues.push(`claim:evidence_mismatch:${supportIssue}:${fingerprint || 'unknown'}:${clean(evidenceKey)}`);
        }
      }
    }
  }

  return { passed: issues.length === 0, issues: [...new Set(issues)] };
}
