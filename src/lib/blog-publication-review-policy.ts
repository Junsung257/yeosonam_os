export type InformationalReviewStatus =
  | 'none'
  | 'pending_review'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | null
  | undefined;

export interface InformationalReviewPolicyInput {
  productId?: string | null;
  reviewStatus?: InformationalReviewStatus | string;
  title?: string | null;
  category?: string | null;
  contentType?: string | null;
  topic?: string | null;
}

export type InformationalReviewBlockReason =
  | 'review_not_approved'
  | 'high_risk_human_review_required';

const BLOCKED_REVIEW_STATUSES = new Set([
  'pending_review',
  'in_review',
  'rejected',
  'changes_requested',
]);

const HIGH_RISK_INFORMATION_RE = /(?:입국|출입국|비자|여권|세관|면세|전자여행허가|여행자\s*보험|여행\s*보험|보험\s*(?:보장|면책|청구)|\bvisa\b|immigration|passport|customs|duty[ -]?free|\b(?:eta|esta)\b|travel\s*insurance)/i;

function combinedPolicyText(input: InformationalReviewPolicyInput): string {
  return [input.title, input.category, input.contentType, input.topic]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

export function isHighRiskInformationalTopic(input: InformationalReviewPolicyInput): boolean {
  return !input.productId && HIGH_RISK_INFORMATION_RE.test(combinedPolicyText(input));
}

export function getInformationalReviewBlockReason(
  input: InformationalReviewPolicyInput,
): InformationalReviewBlockReason | null {
  if (input.productId) return null;

  const reviewStatus = String(input.reviewStatus || 'none');
  if (BLOCKED_REVIEW_STATUSES.has(reviewStatus)) return 'review_not_approved';
  if (isHighRiskInformationalTopic(input) && reviewStatus !== 'approved') {
    return 'high_risk_human_review_required';
  }
  return null;
}

