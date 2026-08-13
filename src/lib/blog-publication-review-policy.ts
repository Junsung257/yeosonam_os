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

export const BLOG_PUBLIC_BLOCKED_REVIEW_STATUSES = [
  'pending_review',
  'in_review',
  'rejected',
  'changes_requested',
] as const;

const BLOCKED_REVIEW_STATUSES = new Set<string>(BLOG_PUBLIC_BLOCKED_REVIEW_STATUSES);
const HIGH_RISK_INFORMATION_RE = /(?:비자|입국|출입국|이민국|여권|세관|면세|보험\s*(?:보장|면책|청구)|여행자?\s*보험|법률|규제|안전\s*(?:경보|주의보)|건강|의료|질병|예방접종|\bvisa\b|immigration|passport|customs|duty[ _-]?free|\b(?:eta|esta|etias)\b|entry[ _-]*requirements?|travel[ _-]*insurance|health[ _-]*advisory|safety[ _-]*alert)/i;

function combinedPolicyText(input: InformationalReviewPolicyInput): string {
  return [input.title, input.category, input.contentType, input.topic]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

export function isHighRiskInformationalTopic(input: InformationalReviewPolicyInput): boolean {
  return HIGH_RISK_INFORMATION_RE.test(combinedPolicyText(input));
}

export function getInformationalReviewBlockReason(
  input: InformationalReviewPolicyInput,
): InformationalReviewBlockReason | null {
  const reviewStatus = String(input.reviewStatus || 'none');
  if (BLOCKED_REVIEW_STATUSES.has(reviewStatus)) return 'review_not_approved';
  if (isHighRiskInformationalTopic(input) && reviewStatus !== 'approved') {
    return 'high_risk_human_review_required';
  }
  return null;
}
