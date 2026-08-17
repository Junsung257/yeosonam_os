import { describe, expect, it } from 'vitest';
import { evaluateBlogPublicEligibility, type BlogPublicEligibilityRow } from '@/lib/blog-public-eligibility';
import { toBlogInformationClaimValidationMeta } from '@/lib/blog-information-claim-publish-gate';

function v2(overrides: Partial<BlogPublicEligibilityRow> = {}): BlogPublicEligibilityRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'osaka-airport-transport',
    status: 'published',
    channel: 'naver_blog',
    productId: null,
    reviewStatus: null,
    title: '오사카 공항 교통',
    category: 'travel_tips',
    contentType: 'guide',
    topic: '오사카 공항 교통',
    createdAt: '2026-07-15T12:00:00+09:00',
    publishedAt: '2026-07-15T12:00:00+09:00',
    generationMeta: {
      engine_version: 'blog-engine-v2',
      content_brief: {
        destination_id: 'osaka',
        intent_type: 'airport_transport',
        audience: 'general',
        locale: 'ko-KR',
      },
      information_claim_validation: { passed: true },
    },
    qualityGate: { passed: true },
    representative: {
      status: 'active',
      canonicalCreativeId: '00000000-0000-4000-8000-000000000001',
      canonicalSlug: 'osaka-airport-transport',
    },
    ...overrides,
  };
}

describe('evaluateBlogPublicEligibility', () => {
  it('persists a bounded claim-gate proof for the public evaluator', () => {
    const issues = Array.from({ length: 25 }, (_, index) => ({
      code: 'missing_evidence' as const,
      claimFingerprint: `claim-${index}`,
      claimType: 'factual' as const,
      message: `issue-${index}`,
    }));
    const meta = toBlogInformationClaimValidationMeta({
      passed: false,
      coverage: 0,
      claims: [],
      issues,
      requiresHumanReview: true,
      lookupError: 'lookup failed',
      ledger: {
        declaredCount: 0,
        candidateCount: 1,
        unclassifiedCount: 1,
        issues: ['claim_ledger_missing'],
      },
    });

    expect(meta).toMatchObject({
      passed: false,
      claim_count: 0,
      requires_human_review: true,
      lookup_error: 'lookup failed',
      auto_regeneration_attempts: 0,
      auto_regeneration_limit: 0,
      ledger: {
        unclassifiedCount: 1,
      },
    });
    expect(meta.issues).toHaveLength(20);
  });

  it('preserves the existing product lane', () => {
    expect(evaluateBlogPublicEligibility(v2({
      productId: '00000000-0000-4000-8000-000000000010',
      generationMeta: null,
      qualityGate: null,
      representative: null,
    }))).toMatchObject({ eligible: true, lane: 'product' });
  });

  it('restores quality-passed pre-contract publications through the explicit cutoff policy', () => {
    expect(evaluateBlogPublicEligibility(v2({
      publishedAt: '2026-07-14T23:59:59+09:00',
      representative: null,
    }))).toMatchObject({ eligible: true, lane: 'information_legacy' });
    expect(evaluateBlogPublicEligibility(v2({
      publishedAt: '2026-07-15T12:00:00+09:00',
      generationMeta: null,
      qualityGate: null,
      representative: null,
    }))).toMatchObject({ eligible: false, reason: 'information_contract_missing' });
  });

  it('does not restore a pre-contract publication without its passed quality record', () => {
    expect(evaluateBlogPublicEligibility(v2({
      publishedAt: '2026-07-14T23:59:59+09:00',
      qualityGate: null,
      representative: null,
    }))).toMatchObject({ eligible: false, reason: 'quality_gate_missing_or_failed' });
  });

  it('does not restore a pre-contract publication in a blocked review state', () => {
    expect(evaluateBlogPublicEligibility(v2({
      publishedAt: '2026-07-14T23:59:59+09:00',
      reviewStatus: 'changes_requested',
      representative: null,
    }))).toMatchObject({ eligible: false, reason: 'review_blocked' });
  });

  it.each([
    ['pending_review', 'review_blocked'],
    ['in_review', 'review_blocked'],
    ['rejected', 'review_blocked'],
    ['changes_requested', 'review_blocked'],
  ])('blocks review state %s', (reviewStatus, reason) => {
    expect(evaluateBlogPublicEligibility(v2({ reviewStatus }))).toMatchObject({ eligible: false, reason });
  });

  it('requires explicit approval for high-risk information', () => {
    const highRisk = v2({
      title: '일본 입국 비자 준비',
      topic: 'entry requirements',
      generationMeta: {
        ...v2().generationMeta,
        content_brief: {
          destination_id: 'japan',
          intent_type: 'entry_requirements',
          audience: 'general',
          locale: 'ko-KR',
        },
      },
    });
    expect(evaluateBlogPublicEligibility(highRisk)).toMatchObject({ eligible: false, reason: 'review_blocked' });
    expect(evaluateBlogPublicEligibility({ ...highRisk, reviewStatus: 'approved' })).toMatchObject({ eligible: true });
  });

  it('blocks medication information until a human approves it', () => {
    const medication = v2({
      title: '해외여행 약과 처방약 반입',
      topic: 'travel medication',
    });
    expect(evaluateBlogPublicEligibility(medication)).toMatchObject({
      eligible: false,
      reason: 'review_blocked',
    });
    expect(evaluateBlogPublicEligibility({ ...medication, reviewStatus: 'approved' })).toMatchObject({
      eligible: true,
    });
  });

  it('honors the planner human-review flag even when title heuristics are quiet', () => {
    const generationMeta = v2().generationMeta as Record<string, unknown>;
    expect(evaluateBlogPublicEligibility(v2({
      title: 'Quiet planning guide',
      topic: 'general',
      generationMeta: {
        ...generationMeta,
        content_brief: {
          ...generationMeta.content_brief as Record<string, unknown>,
          requires_human_review: true,
        },
      },
    }))).toMatchObject({ eligible: false, reason: 'review_blocked' });
  });

  it.each([
    [v2({ qualityGate: null }), 'quality_gate_missing_or_failed'],
    [v2({ qualityGate: { passed: false } }), 'quality_gate_missing_or_failed'],
    [v2({ generationMeta: { ...v2().generationMeta, information_claim_validation: { passed: false } } }), 'claim_gate_missing_or_failed'],
    [v2({ representative: null }), 'representative_missing_or_inactive'],
    [v2({ representative: { status: 'reserved', canonicalCreativeId: v2().id, canonicalSlug: v2().slug } }), 'representative_missing_or_inactive'],
    [v2({ representative: { status: 'active', canonicalCreativeId: v2().id, canonicalSlug: 'other' } }), 'representative_canonical_mismatch'],
    [v2({ fallback: true }), 'fallback_content'],
    [v2({ generationMeta: { ...v2().generationMeta, noindex: true } }), 'noindex'],
    [v2({ generationMeta: { ...v2().generationMeta, redirect_to: '/blog/canonical' } }), 'redirected'],
  ])('blocks an ineligible public row: %s', (row, reason) => {
    expect(evaluateBlogPublicEligibility(row as BlogPublicEligibilityRow)).toMatchObject({ eligible: false, reason });
  });

  it('allows an active canonical V2 representative', () => {
    expect(evaluateBlogPublicEligibility(v2())).toEqual({
      eligible: true,
      lane: 'information_v2',
      reason: 'eligible_information_v2',
    });
  });
});
