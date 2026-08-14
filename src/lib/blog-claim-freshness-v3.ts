export interface BlogClaimFreshnessInput {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  verificationStatus: string;
  conflictStatus?: string | null;
  sourceType?: string | null;
  retrievedAt?: string | null;
  expiresAt?: string | null;
  reviewerId?: string | null;
  reviewedAt?: string | null;
}

export interface BlogClaimFreshnessResult {
  publishable: boolean;
  stale: boolean;
  reasons: string[];
}

const OFFICIAL_PRIMARY = new Set([
  'government', 'embassy', 'immigration', 'customs', 'airport', 'transport_operator',
  'insurer_policy', 'regulator', 'official_tourism', 'official_operator', 'law', 'official_notice',
]);

export function evaluateBlogClaimFreshnessV3(
  claim: BlogClaimFreshnessInput,
  now = new Date(),
): BlogClaimFreshnessResult {
  const reasons: string[] = [];
  const expiry = claim.expiresAt ? Date.parse(claim.expiresAt) : Number.NaN;
  const stale = Number.isFinite(expiry) && expiry <= now.getTime();
  if (claim.verificationStatus !== 'supported' && claim.verificationStatus !== 'approved') {
    reasons.push('claim_not_verified');
  }
  if (stale) reasons.push('claim_expired');
  if (claim.conflictStatus === 'possible' || claim.conflictStatus === 'confirmed') {
    reasons.push('claim_source_conflict');
  }
  if (claim.riskLevel === 'HIGH') {
    if (!OFFICIAL_PRIMARY.has(String(claim.sourceType || ''))) reasons.push('high_risk_primary_source_required');
    if (!claim.reviewerId || !claim.reviewedAt) reasons.push('high_risk_human_approval_required');
  }
  if (claim.riskLevel === 'MEDIUM') {
    if (!claim.sourceType) reasons.push('medium_risk_authority_source_required');
    if (!claim.expiresAt) reasons.push('medium_risk_expiry_required');
  }
  return { publishable: reasons.length === 0, stale, reasons };
}

export type BlogUpdateKind = 'material' | 'cosmetic';

export function applyBlogUpdateTimestampsV3(input: {
  kind: BlogUpdateKind;
  previousContentModifiedAt?: string | null;
  previousFactCheckedAt?: string | null;
  now: string;
  reason?: string | null;
}) {
  if (input.kind === 'cosmetic') {
    return {
      contentModifiedAt: input.previousContentModifiedAt ?? null,
      factCheckedAt: input.previousFactCheckedAt ?? null,
      materialUpdateReason: null,
    };
  }
  if (!input.reason?.trim()) throw new Error('material_update_reason_required');
  return {
    contentModifiedAt: input.now,
    factCheckedAt: input.now,
    materialUpdateReason: input.reason.trim(),
  };
}
