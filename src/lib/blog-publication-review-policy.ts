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
const HIGH_RISK_INFORMATION_RE = /(?:비자|입국|출입국|이민국|여권|세관|면세|보험\s*(?:보장|면책|청구)|여행자?\s*보험|법률|규제|안전\s*(?:경보|주의보)|건강|의료|질병|예방접종|의약품|상비약|비상약|처방약|처방전|약국|복용|(?:해외\s*여행|여행|휴대|반입|처방|상비|비상)\s*약(?:품)?(?=$|\s|[,./·:;!?()])|\bvisa\b|immigration|passport|customs|duty[ _-]?free|\b(?:eta|esta|etias)\b|entry[ _-]*requirements?|travel[ _-]*insurance|health[ _-]*advisory|safety[ _-]*alert|\b(?:medication|medicine|prescription|pharmacy)\b)/i;

// V4's unattended lane is stricter than the legacy public-surface classifier.
// Dynamic commercial/travel-operational facts are discarded before an AI call,
// while the legacy classifier remains stable for already-published snapshots.
const V4_AUTO_DISCARD_INFORMATION_RE = /(?:가격|요금|비용|최저가|할인|프로모션|잔여\s*석|잔여\s*좌석|예약\s*(?:가능|불가|마감)|판매\s*(?:가능|불가)|재고|출발\s*확정|운항|항공편|운영\s*시간|영업\s*시간|휴무|폐장|입장\s*(?:가능|불가)|flight[ _-]*(?:schedule|status)|availability|inventory|promotion|operating[ _-]*hours?)/i;

function combinedPolicyText(input: InformationalReviewPolicyInput): string {
  return [input.title, input.category, input.contentType, input.topic]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

export function isHighRiskInformationalTopic(input: InformationalReviewPolicyInput): boolean {
  return HIGH_RISK_INFORMATION_RE.test(combinedPolicyText(input));
}

export function isHighRiskAutoDiscardTopic(input: InformationalReviewPolicyInput): boolean {
  const text = combinedPolicyText(input);
  return HIGH_RISK_INFORMATION_RE.test(text) || V4_AUTO_DISCARD_INFORMATION_RE.test(text);
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
