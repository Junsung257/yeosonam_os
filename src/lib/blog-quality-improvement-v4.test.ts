import { describe, expect, it } from 'vitest';
import {
  BLOG_SAFE_INFORMATION_INTENTS_V4,
  approveBlogContentImprovementProposalV4,
  buildBlogQualityEvaluationV4,
  buildBlogQualityRegressionReportV4,
  canApplyBlogContentImprovementProposalV4,
  createBlogContentImprovementProposalV4,
  createBlogQualityClaimHash,
  createBlogQualityEvidenceHash,
  detectBlogTopicCollisionV4,
  evaluateBlogQualityClaimHashPreservationV4,
  evaluateBlogProductDecisionBriefV4,
  validateBlogPerformanceLearningSnapshotV4,
  type BlogQualityScoresV4,
} from './blog-quality-improvement-v4';

const passingScores: BlogQualityScoresV4 = {
  factuality: 100,
  intent: 100,
  structure: 100,
  readability: 98,
  originality: 96,
  publicSurface: 100,
  seo: 97,
  imageRelevance: 96,
  ctaPressure: 100,
};

function createProposal(overrides: Partial<Parameters<typeof createBlogContentImprovementProposalV4>[0]> = {}) {
  return createBlogContentImprovementProposalV4({
    proposalId: 'proposal-1',
    candidateId: 'candidate-1',
    baseContentVersion: 'content-v1',
    targetContentVersion: 'content-v2',
    reasonCodes: ['readability'],
    changes: [{
      path: 'body.h2[1]',
      code: 'simplify_sentence',
      rationale: '문장을 짧게 나눕니다.',
      beforeHash: 'before-hash',
    }],
    evidenceRefs: ['evidence-1'],
    impact: { claimsChanged: false, publicSurfaceChanged: true, publicationRisk: 'low' },
    rollbackRef: 'content-v1',
    proposedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  });
}

describe('blog quality improvement V4 contract', () => {
  it('covers the nine low-risk information intents without enabling high-risk lanes', () => {
    expect(BLOG_SAFE_INFORMATION_INTENTS_V4).toHaveLength(9);
    expect(BLOG_SAFE_INFORMATION_INTENTS_V4).not.toContain('entry_requirements');
    expect(BLOG_SAFE_INFORMATION_INTENTS_V4).not.toContain('travel_insurance');
  });

  it('hashes the atomic claim set independently from style/order changes', () => {
    const result = evaluateBlogQualityClaimHashPreservationV4({
      beforeClaims: ['공식 운영사는 오전 6시에 첫차를 운행합니다.', '요금은 확인일 기준입니다.'],
      afterClaims: ['요금은 확인일 기준입니다.', '공식 운영사는 오전 6시에 첫차를 운행합니다.'],
    });
    expect(result.preserved).toBe(true);
    expect(result.beforeHash).toBe(result.afterHash);
    expect(createBlogQualityClaimHash(['새로운 숫자 1개'])).not.toBe(result.beforeHash);
  });

  it('blocks an unsupported claim change from being treated as a style proposal', () => {
    expect(() => createProposal({
      impact: { claimsChanged: true, publicSurfaceChanged: true, publicationRisk: 'low' },
    })).toThrow('factual_upgrade');
  });

  it('creates a proposal without applying any content mutation', () => {
    const proposal = createProposal();
    expect(proposal.status).toBe('proposed');
    expect(proposal.baseContentVersion).toBe('content-v1');
    expect(proposal.approvalLineage).toBeUndefined();
    expect(canApplyBlogContentImprovementProposalV4(proposal)).toEqual({
      allowed: false,
      reason: 'human_approval_required',
    });
  });

  it('requires explicit approval lineage before a proposal can apply', () => {
    const proposal = approveBlogContentImprovementProposalV4(
      createProposal(),
      {
        proposalId: 'proposal-1',
        status: 'approved',
        actorId: 'editor-1',
        approvedAt: '2026-08-25T00:05:00.000Z',
        reason: '문장 가독성만 개선하고 claim은 보존함',
      },
    );
    expect(canApplyBlogContentImprovementProposalV4(proposal)).toEqual({
      allowed: true,
      reason: 'approved_proposal_only',
    });
  });

  it('keeps factual replacements on the reviewed atomic path', () => {
    const proposal = approveBlogContentImprovementProposalV4(
      createProposal({
        reasonCodes: ['factual_upgrade'],
        impact: { claimsChanged: true, publicSurfaceChanged: true, publicationRisk: 'high' },
      }),
      {
        proposalId: 'proposal-1',
        status: 'approved',
        actorId: 'editor-1',
        approvedAt: '2026-08-25T00:05:00.000Z',
        reason: '새로 검토된 공식 근거로 교체',
      },
    );
    expect(canApplyBlogContentImprovementProposalV4(proposal)).toEqual({
      allowed: false,
      reason: 'claim_change_requires_atomic_reviewed_replacement',
    });
  });

  it('maps quality blockers to quarantine, repair, or publish recommendations', () => {
    expect(buildBlogQualityEvaluationV4({
      candidateId: 'candidate-1',
      contentVersion: 'content-v1',
      promptVersion: 'prompt-v1',
      claimHash: 'claim-hash',
      sourceEvidenceHash: 'evidence-hash',
      scores: passingScores,
      publishGatePassed: true,
      evaluatedAt: '2026-08-25T00:00:00.000Z',
    }).recommendedAction).toBe('publish');
    expect(buildBlogQualityEvaluationV4({
      candidateId: 'candidate-1',
      contentVersion: 'content-v1',
      promptVersion: 'prompt-v1',
      claimHash: 'claim-hash',
      sourceEvidenceHash: 'evidence-hash',
      scores: passingScores,
      publishGatePassed: true,
      blockers: ['readability'],
    }).recommendedAction).toBe('repair');
    expect(buildBlogQualityEvaluationV4({
      candidateId: 'candidate-1',
      contentVersion: 'content-v1',
      promptVersion: 'prompt-v1',
      claimHash: 'claim-hash',
      sourceEvidenceHash: 'evidence-hash',
      scores: passingScores,
      publishGatePassed: true,
      blockers: ['unsupported_number'],
    }).recommendedAction).toBe('quarantine');
    expect(buildBlogQualityEvaluationV4({
      candidateId: 'candidate-1',
      contentVersion: 'content-v1',
      promptVersion: 'prompt-v1',
      claimHash: 'claim-hash',
      sourceEvidenceHash: 'evidence-hash',
      scores: passingScores,
      publishGatePassed: false,
    }).recommendedAction).toBe('human_review');
  });

  it('validates evidence hashes, learning windows, and metrics', () => {
    expect(createBlogQualityEvidenceHash(['source-b', 'source-a'])).toBe(createBlogQualityEvidenceHash(['source-a', 'source-b']));
    expect(() => validateBlogPerformanceLearningSnapshotV4({
      candidateId: 'candidate-1',
      window: '7d',
      cohort: { intent: 'monthly_weather', positionBand: 'top10' },
      metrics: { impressions: 100, clicks: 10, ctr: 0.1, avgPosition: 7, conversions: 1 },
      observedAt: '2026-08-25T00:00:00.000Z',
    })).not.toThrow();
    expect(() => validateBlogPerformanceLearningSnapshotV4({
      candidateId: 'candidate-1',
      window: '7d',
      cohort: { intent: 'monthly_weather', positionBand: 'top10' },
      metrics: { impressions: 100, clicks: 10, ctr: 1.1, avgPosition: 7, conversions: 1 },
      observedAt: '2026-08-25T00:00:00.000Z',
    })).toThrow('invalid_learning_ctr');
  });

  it('detects same destination/intent cannibalization before generation', () => {
    const base = {
      candidateId: 'candidate-1',
      title: '괌 공항에서 시내까지 이동 방법과 교통비',
      h2s: ['공항에서 시내 이동', '택시와 버스 요금'],
      claimTexts: ['공식 운영시간과 요금을 확인하세요.'],
      intent: 'airport_transport',
      destination: '괌',
      audience: '한국인 자유여행자',
    };
    const report = detectBlogTopicCollisionV4(base, { ...base, candidateId: 'existing-1' });
    expect(report.collision).toBe(true);
    expect(report.reasons).toContain('same_representative_scope');
  });

  it('requires an immutable product snapshot and checked price basis', () => {
    const valid = evaluateBlogProductDecisionBriefV4({
      productId: 'product-1',
      contentVersion: 'content-v1',
      productSnapshotHash: 'snapshot-hash',
      title: '괌 가족 패키지',
      destination: '괌',
      price: { amount: 1290000, currency: 'KRW', basis: '2026-08-25 확인, 2인 1실 기준', checkedAt: '2026-08-25' },
      inclusions: ['항공'],
      exclusions: ['개인경비'],
      travelerFit: ['가족'],
      bookingChannel: 'official-product-detail',
    });
    expect(valid.passed).toBe(true);
    const manipulated = evaluateBlogProductDecisionBriefV4({
      productId: 'product-1',
      contentVersion: 'content-v1',
      productSnapshotHash: '',
      title: '괌 가족 패키지',
      destination: '괌',
      price: { amount: 1290000, currency: 'KRW', basis: '', checkedAt: '' },
      inclusions: ['항공'],
      exclusions: ['개인경비'],
      travelerFit: ['가족'],
      bookingChannel: 'official-product-detail',
    });
    expect(manipulated.passed).toBe(false);
    expect(manipulated.blockers).toEqual(expect.arrayContaining([
      'missing_product_snapshot_hash',
      'missing_price_basis',
      'missing_price_checked_at',
    ]));
  });

  it('builds a fixture-only regression report with zero external calls and mutations', () => {
    const report = buildBlogQualityRegressionReportV4(BLOG_SAFE_INFORMATION_INTENTS_V4.map(intent => ({
      id: `fixture-${intent}`,
      intent,
      passed: true,
      blockers: [],
    })));
    expect(report.ok).toBe(true);
    expect(report.total).toBe(9);
    expect(report.externalCalls).toBe(0);
    expect(report.publicMutations).toBe(0);
  });
});
