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
  sources: BlogInformationSourceInput[];
  evidence: BlogInformationEvidenceInput[];
  claims: BlogInformationClaimInput[];
}

export interface BlogInformationResearchBundleValidation {
  passed: boolean;
  issues: string[];
}

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
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

  const excerpt = normalizeMeaning(evidence.excerpt);
  if (!excerpt) return [...issues, 'missing_excerpt'];
  if (!equivalentSemanticValueTokens(scope.normalizedValue).some((token) => excerpt.includes(normalizeMeaning(token)))) {
    issues.push('excerpt_value_mismatch');
  }
  if (scope.unit && !equivalentUnitTokens(scope.unit).some((token) => excerpt.includes(normalizeMeaning(token)))) {
    issues.push('excerpt_unit_mismatch');
  }
  if (scope.currency && !equivalentCurrencyTokens(scope.currency).some((token) => excerpt.includes(normalizeMeaning(token)))) {
    issues.push('excerpt_currency_mismatch');
  }
  const locations = [scope.country, scope.destination]
    .map(normalizeMeaning)
    .filter(Boolean);
  if (!locations.some((target) => excerpt.includes(target))) issues.push('excerpt_location_mismatch');
  if (!excerpt.includes(normalizeMeaning(scope.applicableTo))) issues.push('excerpt_applicable_to_mismatch');
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
    if (normalizeMeaning(scope.normalizedValue) !== normalizeMeaning(input.extractedValue.normalizedValue)) {
      issues.push('normalized_value_mismatch');
    }
    if (normalizeMeaning(scope.unit) !== normalizeMeaning(input.extractedValue.unit)) issues.push('unit_mismatch');
    if (normalizeMeaning(scope.currency) !== normalizeMeaning(input.extractedValue.currency)) issues.push('currency_mismatch');
  }
  for (const [key, value] of Object.entries(input.expectedScope ?? {})) {
    if (value && normalizeMeaning(scope[key as keyof BlogInformationEvidenceScope]) !== normalizeMeaning(value)) {
      issues.push(`${key}_mismatch`);
    }
  }
  return { passed: issues.length === 0, issues: [...new Set(issues)] };
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
    if (!validWindow(evidence.validFrom, evidence.validUntil)) issues.push(`evidence:invalid_valid_window:${key || 'unknown'}`);
    for (const scopeIssue of validateBlogInformationEvidenceScope(evidence)) {
      issues.push(`evidence:scope:${scopeIssue}:${key || 'unknown'}`);
    }
    const source = sourceByKey.get(clean(evidence.sourceKey));
    if (source?.country && normalizeMeaning(source.country) !== normalizeMeaning(evidence.scope?.country)) {
      issues.push(`evidence:source_country_mismatch:${key || 'unknown'}`);
    }
    if (source?.destination && normalizeMeaning(source.destination) !== normalizeMeaning(evidence.scope?.destination)) {
      issues.push(`evidence:source_destination_mismatch:${key || 'unknown'}`);
    }
  }

  const claimFingerprints = new Set<string>();
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
