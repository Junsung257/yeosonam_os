import type { BlogPublicEligibilityRow } from './blog-public-eligibility';

export interface BlogPublicEligibilityFixture {
  id: string;
  expectedEligible: boolean;
  expectedReason: string;
  row: BlogPublicEligibilityRow;
}

const base: BlogPublicEligibilityRow = {
  id: 'creative-1',
  slug: 'useful-guide',
  status: 'published',
  channel: 'naver_blog',
  reviewStatus: 'none',
  publishedAt: '2026-08-10T00:00:00Z',
  generationMeta: {
    content_brief: { destination_id: 'osaka', intent_type: 'hotel_areas', audience: 'general', locale: 'ko-KR' },
    information_claim_validation: { passed: true },
  },
  qualityGate: { passed: true },
  representative: {
    status: 'active',
    canonicalCreativeId: 'creative-1',
    canonicalSlug: 'useful-guide',
  },
};

export const BLOG_PUBLIC_ELIGIBILITY_FIXTURES: BlogPublicEligibilityFixture[] = [
  { id: 'eligible-v3', expectedEligible: true, expectedReason: 'eligible_information_v2', row: base },
  { id: 'draft', expectedEligible: false, expectedReason: 'not_published', row: { ...base, status: 'draft' } },
  {
    id: 'changes-requested-product', expectedEligible: false, expectedReason: 'review_blocked',
    row: { ...base, productId: 'product-1', reviewStatus: 'changes_requested' },
  },
  {
    id: 'high-risk-unapproved', expectedEligible: false, expectedReason: 'review_blocked',
    row: { ...base, title: 'ETIAS 입국 규정 변경', reviewStatus: 'none' },
  },
  {
    id: 'korean-only-high-risk-unapproved', expectedEligible: false, expectedReason: 'review_blocked',
    row: { ...base, title: '베트남 여권과 세관 면세 규정', reviewStatus: 'none' },
  },
  {
    id: 'high-risk-approved', expectedEligible: true, expectedReason: 'eligible_information_v2',
    row: { ...base, title: 'ETIAS 입국 규정 변경', reviewStatus: 'approved' },
  },
  {
    id: 'travel-insurance-intent-unapproved', expectedEligible: false, expectedReason: 'review_blocked',
    row: {
      ...base,
      title: '여름 휴가 해외여행자 보험 안내',
      topic: 'travel_insurance',
      reviewStatus: 'none',
    },
  },
  {
    id: 'legacy-review-blocked', expectedEligible: false, expectedReason: 'review_blocked',
    row: {
      ...base,
      publishedAt: '2026-07-01T00:00:00Z',
      generationMeta: {},
      representative: null,
      reviewStatus: 'pending_review',
    },
  },
  {
    id: 'legacy-low-risk', expectedEligible: true, expectedReason: 'eligible_information_legacy',
    row: {
      ...base,
      publishedAt: '2026-07-01T00:00:00Z',
      generationMeta: {},
      representative: null,
    },
  },
  {
    id: 'noindex', expectedEligible: false, expectedReason: 'noindex',
    row: { ...base, generationMeta: { ...base.generationMeta, noindex: true } },
  },
  {
    id: 'representative-mismatch', expectedEligible: false, expectedReason: 'representative_canonical_mismatch',
    row: { ...base, representative: { ...base.representative, canonicalSlug: 'other' } },
  },
];
