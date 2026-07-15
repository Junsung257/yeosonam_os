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
  capturedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface BlogInformationClaimInput {
  claimFingerprint: string;
  claimText: string;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
  extractedValue?: Record<string, unknown>;
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
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
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

export function validateBlogInformationResearchBundle(
  bundle: BlogInformationResearchBundle,
): BlogInformationResearchBundleValidation {
  const issues: string[] = [];
  if (!clean(bundle.contentKey)) issues.push('missing_content_key');
  if (bundle.sources.length === 0) issues.push('missing_sources');
  if (bundle.evidence.length === 0) issues.push('missing_evidence');
  if (bundle.claims.length === 0) issues.push('missing_claims');

  const sourceKeys = new Set<string>();
  for (const source of bundle.sources) {
    const key = clean(source.sourceKey);
    if (!key) issues.push('source:missing_source_key');
    else if (sourceKeys.has(key)) issues.push(`source:duplicate_source_key:${key}`);
    else sourceKeys.add(key);
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
  for (const evidence of bundle.evidence) {
    const key = clean(evidence.evidenceKey);
    if (!key) issues.push('evidence:missing_evidence_key');
    else if (evidenceKeys.has(key)) issues.push(`evidence:duplicate_evidence_key:${key}`);
    else evidenceKeys.add(key);
    if (!sourceKeys.has(clean(evidence.sourceKey))) issues.push(`evidence:unknown_source:${key || 'unknown'}`);
    if (!isIsoDate(evidence.observedAt)) issues.push(`evidence:invalid_observed_at:${key || 'unknown'}`);
    if (!validWindow(evidence.validFrom, evidence.validUntil)) issues.push(`evidence:invalid_valid_window:${key || 'unknown'}`);
  }

  const claimFingerprints = new Set<string>();
  for (const claim of bundle.claims) {
    const fingerprint = clean(claim.claimFingerprint);
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) issues.push('claim:invalid_fingerprint');
    else if (claimFingerprints.has(fingerprint)) issues.push(`claim:duplicate_fingerprint:${fingerprint}`);
    else claimFingerprints.add(fingerprint);
    if (!clean(claim.claimText)) issues.push(`claim:missing_text:${fingerprint || 'unknown'}`);
    if (claim.requiresEvidence && claim.evidenceKeys.length === 0) {
      issues.push(`claim:missing_evidence:${fingerprint || 'unknown'}`);
    }
    for (const evidenceKey of claim.evidenceKeys) {
      if (!evidenceKeys.has(clean(evidenceKey))) {
        issues.push(`claim:unknown_evidence:${fingerprint || 'unknown'}:${clean(evidenceKey) || 'blank'}`);
      }
    }
  }

  return { passed: issues.length === 0, issues: [...new Set(issues)] };
}
