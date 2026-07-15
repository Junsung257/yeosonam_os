import { stripMarkup } from './blog-text-utils';
import {
  createBlogInformationClaimFingerprint,
  isOfficialInformationAuthority,
  type BlogInformationAuthorityLevel,
  type BlogInformationClaimType,
  type BlogInformationEvidenceRiskLevel,
} from './blog-information-evidence';

export interface ExtractedBlogInformationClaim {
  claimFingerprint: string;
  claimText: string;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
}

export interface BlogInformationClaimEvidenceRecord {
  evidenceKey: string;
  claimType: BlogInformationClaimType;
  observedAt: string;
  validUntil?: string | null;
  source: {
    authorityLevel: BlogInformationAuthorityLevel;
    retrievedAt: string;
    validUntil?: string | null;
    status?: 'active' | 'expired' | 'revoked';
  };
}

export interface PersistedBlogInformationClaimRecord {
  claimFingerprint: string;
  claimType: BlogInformationClaimType;
  validationStatus: 'pending' | 'supported' | 'unsupported' | 'stale' | 'review_required' | 'approved' | 'rejected';
  evidence: BlogInformationClaimEvidenceRecord[];
}

export interface BlogInformationClaimValidationIssue {
  code:
    | 'missing_evidence'
    | 'claim_not_supported'
    | 'stale_evidence'
    | 'official_source_required'
    | 'human_approval_required';
  claimFingerprint: string;
  claimType: BlogInformationClaimType;
  message: string;
}

export interface BlogInformationClaimValidationReport {
  passed: boolean;
  claims: ExtractedBlogInformationClaim[];
  issues: BlogInformationClaimValidationIssue[];
  coverage: number;
  requiresHumanReview: boolean;
}

const PRICE_RE = /(?:\d[\d,.]*\s*(?:원|엔|달러|위안|유로|바트|동|페소|링깃|루피|파운드|프랑|JPY|USD|CNY|EUR|THB|VND|KRW))|(?:(?:가격|요금|비용|예산)\s*(?:은|는|이|가|:)?\s*\d)/i;
const DURATION_RE = /(?:약\s*)?\d+(?:\.\d+)?\s*(?:분|시간)(?:\s*(?:~|-|–)\s*\d+(?:\.\d+)?\s*(?:분|시간))?/i;
const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;
const CLIMATE_RE = /(?:\d+(?:\.\d+)?\s*(?:℃|°C|mm)|(?:최고|최저|평균)\s*기온\s*-?\d|강수(?:량|일)\s*\d|습도\s*\d+\s*%)/i;
const CUSTOMS_RE = /(?:세관|면세|반입|반출|신고s*한도|면세s*한도).*(?:\d|한도|금지|허용|신고|면제)/i;
const ENTRY_RE = /(?:입국|출입국|비자|여권|전자여행허가|ETA|ESTA).*(?:필요|불필요|면제|유효|가능|불가|금지|허용|의무|신고|체류)/i;
const INSURANCE_RE = /(?:여행자?\s*보험|보험).*(?:보장|면책|제외|자기부담|청구|한도|가입|의무)/i;
const POLICY_RE = /(?:규정|정책|법률|법정|의무|금지|허용|운영시간|첫차|막차).*(?:\d|변경|적용|위반|가능|불가|해야|됩니다|입니다)/i;
const SUPERLATIVE_RE = /(?:가장\s*(?:저렴|비싸|빠르|느리|좋|많|적|높|낮|인기)|최고|최저|유일|1위|최대|최소|압도적)/i;

const HIGH_RISK_CLAIM_TYPES = new Set<BlogInformationClaimType>([
  'customs',
  'entry_visa',
  'insurance',
  'policy',
]);

const MAX_SOURCE_AGE_DAYS: Record<BlogInformationClaimType, number> = {
  price: 30,
  currency: 7,
  duration: 30,
  percentage: 90,
  climate: 365,
  customs: 30,
  entry_visa: 30,
  insurance: 30,
  policy: 30,
  superlative: 30,
  factual: 365,
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[-*#>|\s]+/, '').trim();
}

function splitClaimSegments(markdown: string): string[] {
  const plain = stripMarkup(markdown)
    .replace(/\r\n?/g, '\n')
    .replace(/\|/g, '\n');
  return [...new Set(plain
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map(clean)
    .filter((segment) => segment.length >= 4 && segment.length <= 500))];
}

function classifyClaim(segment: string): Pick<ExtractedBlogInformationClaim, 'claimType' | 'riskLevel'> | null {
  if (CUSTOMS_RE.test(segment)) return { claimType: 'customs', riskLevel: 'HIGH' };
  if (ENTRY_RE.test(segment)) return { claimType: 'entry_visa', riskLevel: 'HIGH' };
  if (INSURANCE_RE.test(segment)) return { claimType: 'insurance', riskLevel: 'HIGH' };
  if (CLIMATE_RE.test(segment)) return { claimType: 'climate', riskLevel: 'MEDIUM' };
  if (PRICE_RE.test(segment)) return { claimType: /환율|통화|환전/i.test(segment) ? 'currency' : 'price', riskLevel: 'MEDIUM' };
  if (DURATION_RE.test(segment)) return { claimType: 'duration', riskLevel: 'MEDIUM' };
  if (PERCENT_RE.test(segment)) return { claimType: 'percentage', riskLevel: 'MEDIUM' };
  if (POLICY_RE.test(segment)) return { claimType: 'policy', riskLevel: 'HIGH' };
  if (SUPERLATIVE_RE.test(segment)) return { claimType: 'superlative', riskLevel: 'MEDIUM' };
  return null;
}

export function extractBlogInformationClaims(markdown: string): ExtractedBlogInformationClaim[] {
  return splitClaimSegments(markdown).flatMap((segment) => {
    const classification = classifyClaim(segment);
    if (!classification) return [];
    return [{
      claimFingerprint: createBlogInformationClaimFingerprint(segment),
      claimText: segment,
      ...classification,
    }];
  });
}

function isEvidenceCurrent(
  evidence: BlogInformationClaimEvidenceRecord,
  claimType: BlogInformationClaimType,
  nowMs: number,
): boolean {
  if (evidence.source.status && evidence.source.status !== 'active') return false;
  const explicitExpiry = [evidence.validUntil, evidence.source.validUntil]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value));
  if (explicitExpiry.some((expiry) => Number.isNaN(expiry) || expiry < nowMs)) return false;
  const retrievedAt = Date.parse(evidence.source.retrievedAt);
  if (Number.isNaN(retrievedAt)) return false;
  const maxAgeMs = MAX_SOURCE_AGE_DAYS[claimType] * 24 * 60 * 60 * 1000;
  return nowMs - retrievedAt <= maxAgeMs;
}

export function validateBlogInformationClaims(input: {
  markdown: string;
  persistedClaims: PersistedBlogInformationClaimRecord[];
  reviewStatus?: string | null;
  now?: Date;
}): BlogInformationClaimValidationReport {
  const claims = extractBlogInformationClaims(input.markdown);
  const persistedByFingerprint = new Map(
    input.persistedClaims.map((claim) => [claim.claimFingerprint, claim]),
  );
  const issues: BlogInformationClaimValidationIssue[] = [];
  let supportedClaims = 0;
  const nowMs = (input.now ?? new Date()).getTime();

  for (const claim of claims) {
    const persisted = persistedByFingerprint.get(claim.claimFingerprint);
    if (!persisted || persisted.evidence.length === 0) {
      issues.push({
        code: 'missing_evidence',
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: '검증 대상 claim에 연결된 정보성 evidence가 없습니다.',
      });
      continue;
    }
    if (!['supported', 'approved'].includes(persisted.validationStatus)) {
      issues.push({
        code: 'claim_not_supported',
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: `claim validation status가 발행 가능하지 않습니다: ${persisted.validationStatus}`,
      });
      continue;
    }
    const currentEvidence = persisted.evidence.filter((evidence) =>
      evidence.claimType === claim.claimType && isEvidenceCurrent(evidence, claim.claimType, nowMs));
    if (currentEvidence.length === 0) {
      issues.push({
        code: 'stale_evidence',
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: '현재 유효한 evidence가 없습니다.',
      });
      continue;
    }
    if (
      HIGH_RISK_CLAIM_TYPES.has(claim.claimType)
      && !currentEvidence.some((evidence) => isOfficialInformationAuthority(evidence.source.authorityLevel))
    ) {
      issues.push({
        code: 'official_source_required',
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: '고위험·정책형 claim에는 공식 source가 필요합니다.',
      });
      continue;
    }
    if (HIGH_RISK_CLAIM_TYPES.has(claim.claimType) && input.reviewStatus !== 'approved') {
      issues.push({
        code: 'human_approval_required',
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: '고위험·정책형 claim은 사람 승인 전 발행할 수 없습니다.',
      });
      continue;
    }
    supportedClaims += 1;
  }

  return {
    passed: issues.length === 0,
    claims,
    issues,
    coverage: claims.length === 0 ? 1 : supportedClaims / claims.length,
    requiresHumanReview: claims.some((claim) => HIGH_RISK_CLAIM_TYPES.has(claim.claimType)),
  };
}
