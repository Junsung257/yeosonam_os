import { getInformationalReviewBlockReason } from './blog-publication-review-policy';
import { readBlogInformationRepresentativeIdentity } from './blog-information-representative';

export const PUBLIC_BLOG_READ_SOURCE = 'public_blog_content_creatives';
export const BLOG_INFORMATION_LEGACY_CUTOFF_AT = '2026-07-15T00:00:00+09:00';

export interface BlogPublicRepresentativeTruth {
  status?: string | null;
  canonicalCreativeId?: string | null;
  canonicalSlug?: string | null;
}

export interface BlogPublicEligibilityRow {
  id?: string | null;
  slug?: string | null;
  status?: string | null;
  channel?: string | null;
  productId?: string | null;
  reviewStatus?: string | null;
  title?: string | null;
  category?: string | null;
  contentType?: string | null;
  topic?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  generationMeta?: Record<string, unknown> | null;
  qualityGate?: Record<string, unknown> | null;
  representative?: BlogPublicRepresentativeTruth | null;
  fallback?: boolean;
}

export type BlogPublicEligibilityReason =
  | 'eligible_product'
  | 'eligible_information_legacy'
  | 'eligible_information_v2'
  | 'not_published'
  | 'wrong_channel'
  | 'missing_slug'
  | 'fallback_content'
  | 'noindex'
  | 'redirected'
  | 'information_contract_missing'
  | 'destination_entity_invalid'
  | 'review_blocked'
  | 'quality_gate_missing_or_failed'
  | 'claim_gate_missing_or_failed'
  | 'representative_missing_or_inactive'
  | 'representative_canonical_mismatch';

export type BlogPublicEligibilityResult = {
  eligible: boolean;
  lane: 'product' | 'information_legacy' | 'information_v2' | null;
  reason: BlogPublicEligibilityReason;
};

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isExplicitLegacyInformation(row: BlogPublicEligibilityRow): boolean {
  if (typeof row.publishedAt !== 'string') return false;
  const publishedAt = Date.parse(row.publishedAt);
  const reviewBlocked = ['pending_review', 'in_review', 'rejected', 'changes_requested']
    .includes(row.reviewStatus ?? '');
  return Number.isFinite(publishedAt)
    && publishedAt < Date.parse(BLOG_INFORMATION_LEGACY_CUTOFF_AT)
    && row.qualityGate?.passed === true
    && !reviewBlocked;
}

function hasNoindex(meta: Record<string, unknown> | null | undefined): boolean {
  const seo = nestedRecord(meta?.seo);
  return meta?.noindex === true || seo?.noindex === true;
}

function hasRedirect(meta: Record<string, unknown> | null | undefined): boolean {
  return [meta?.redirect_to, meta?.redirectTo, meta?.canonical_redirect_to]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
}

export function evaluateBlogPublicEligibility(
  row: BlogPublicEligibilityRow,
): BlogPublicEligibilityResult {
  if (row.status !== 'published') return { eligible: false, lane: null, reason: 'not_published' };
  if (row.channel !== 'naver_blog') return { eligible: false, lane: null, reason: 'wrong_channel' };
  const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
  if (!slug) return { eligible: false, lane: null, reason: 'missing_slug' };
  if (row.fallback) return { eligible: false, lane: null, reason: 'fallback_content' };
  if (hasNoindex(row.generationMeta)) return { eligible: false, lane: null, reason: 'noindex' };
  if (hasRedirect(row.generationMeta)) return { eligible: false, lane: null, reason: 'redirected' };

  if (row.productId) {
    return { eligible: true, lane: 'product', reason: 'eligible_product' };
  }

  if (isExplicitLegacyInformation(row)) {
    return {
      eligible: true,
      lane: 'information_legacy',
      reason: 'eligible_information_legacy',
    };
  }

  const identity = readBlogInformationRepresentativeIdentity(row.generationMeta);
  if (!identity) {
    return { eligible: false, lane: 'information_v2', reason: 'information_contract_missing' };
  }
  if (!identity.destinationId.trim() || identity.destinationId === 'unknown') {
    return { eligible: false, lane: 'information_v2', reason: 'destination_entity_invalid' };
  }

  const contentBrief = nestedRecord(row.generationMeta?.content_brief);
  const requiresHumanReview = contentBrief?.requires_human_review === true
    || contentBrief?.intent_type === 'entry_requirements'
    || contentBrief?.intent_type === 'travel_insurance';
  if (requiresHumanReview && row.reviewStatus !== 'approved') {
    return { eligible: false, lane: 'information_v2', reason: 'review_blocked' };
  }

  const reviewBlock = getInformationalReviewBlockReason({
    productId: null,
    reviewStatus: row.reviewStatus,
    title: row.title,
    category: row.category,
    contentType: row.contentType,
    topic: row.topic,
  });
  if (reviewBlock) {
    return { eligible: false, lane: 'information_v2', reason: 'review_blocked' };
  }

  if (row.qualityGate?.passed !== true) {
    return { eligible: false, lane: 'information_v2', reason: 'quality_gate_missing_or_failed' };
  }
  const claimValidation = nestedRecord(row.generationMeta?.information_claim_validation);
  if (claimValidation?.passed !== true) {
    return { eligible: false, lane: 'information_v2', reason: 'claim_gate_missing_or_failed' };
  }

  const representative = row.representative;
  if (representative?.status !== 'active') {
    return { eligible: false, lane: 'information_v2', reason: 'representative_missing_or_inactive' };
  }
  if (
    representative.canonicalCreativeId !== row.id
    || representative.canonicalSlug !== slug
  ) {
    return { eligible: false, lane: 'information_v2', reason: 'representative_canonical_mismatch' };
  }

  return {
    eligible: true,
    lane: 'information_v2',
    reason: 'eligible_information_v2',
  };
}
