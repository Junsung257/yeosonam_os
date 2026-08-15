import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: fromMock,
  },
}));

import {
  isBlogInformationClaimValidationPendingHumanApprovalOnly,
  persistBlogInformationClaimFindings,
  shouldApplyDurableBlogInformationReviewGate,
  toBlogInformationClaimValidationMeta,
} from './blog-information-claim-publish-gate';

describe('claim validation review readiness', () => {
  const claim = {
    claimFingerprint: 'claim-fingerprint',
    claimText: 'ESTA approval is required before travel.',
    claimType: 'entry_visa' as const,
    riskLevel: 'HIGH' as const,
    candidateKind: 'requirement_prohibition' as const,
    extractedValue: {
      normalizedValue: 'ESTA required',
      unit: null,
      currency: null,
    },
  };

  it('separates evidence-ready human approval from a hard validation failure', () => {
    const result = {
      passed: false,
      coverage: 0,
      requiresHumanReview: true,
      claims: [claim],
      issues: [{
        code: 'human_approval_required' as const,
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: 'Human approval is required.',
      }],
    };

    expect(isBlogInformationClaimValidationPendingHumanApprovalOnly(result)).toBe(true);
    expect(toBlogInformationClaimValidationMeta(result)).toMatchObject({
      passed: false,
      pending_human_approval_only: true,
      requires_human_review: true,
    });
  });

  it('does not mark mixed evidence failures as approval-only', () => {
    const result = {
      passed: false,
      coverage: 0,
      requiresHumanReview: true,
      claims: [claim],
      issues: [{
        code: 'missing_evidence' as const,
        claimFingerprint: claim.claimFingerprint,
        claimType: claim.claimType,
        message: 'Evidence is missing.',
      }],
    };

    expect(isBlogInformationClaimValidationPendingHumanApprovalOnly(result)).toBe(false);
  });

  it('does not make a stale draft review case mandatory for a LOW/MEDIUM auto-publish claim set', () => {
    expect(shouldApplyDurableBlogInformationReviewGate({
      reportRequiresHumanReview: false,
      reviewStatus: 'pending_review',
    })).toBe(false);
    expect(shouldApplyDurableBlogInformationReviewGate({
      reportRequiresHumanReview: false,
      reviewStatus: 'changes_requested',
    })).toBe(true);
    expect(shouldApplyDurableBlogInformationReviewGate({
      reportRequiresHumanReview: true,
      reviewStatus: null,
    })).toBe(true);
  });
});

describe('persistBlogInformationClaimFindings', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('detaches claims from an older draft version before linking current claims', async () => {
    const selectEq = vi.fn().mockResolvedValue({
      data: [
        { id: 'old-claim-id', claim_fingerprint: 'old-fingerprint' },
        { id: 'current-claim-id', claim_fingerprint: 'current-fingerprint' },
      ],
      error: null,
    });
    const updateIn = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ in: updateIn }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({
      select: vi.fn(() => ({ eq: selectEq })),
      update,
      upsert,
    });

    await persistBlogInformationClaimFindings({
      creativeId: 'creative-id',
      contentKey: 'guam-weather-packing',
      report: {
        passed: true,
        coverage: 1,
        requiresHumanReview: false,
        issues: [],
        claims: [{
          claimFingerprint: 'current-fingerprint',
          claimText: '1981~2010 평년값: 1월 최고기온 29.4°C',
          claimType: 'climate',
          riskLevel: 'MEDIUM',
          candidateKind: 'climate_measurement',
          extractedValue: {
            normalizedValue: '29.4',
            unit: '°C',
            currency: null,
          },
        }],
      },
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      creative_id: null,
      validation_reason: 'superseded_content_version',
    }));
    expect(updateIn).toHaveBeenCalledWith('id', ['old-claim-id']);
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        creative_id: 'creative-id',
        claim_fingerprint: 'current-fingerprint',
        validation_status: 'supported',
      })],
      { onConflict: 'content_key,claim_fingerprint' },
    );
  });

  it('keeps evidence-supported claims supported while human approval is pending', async () => {
    const selectEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({
      select: vi.fn(() => ({ eq: selectEq })),
      update: vi.fn(),
      upsert,
    });

    await persistBlogInformationClaimFindings({
      creativeId: 'review-draft-id',
      contentKey: 'us-esta-entry-documents',
      report: {
        passed: false,
        coverage: 0,
        requiresHumanReview: true,
        issues: [{
          code: 'human_approval_required',
          claimFingerprint: 'esta-claim',
          claimType: 'entry_visa',
          message: 'Human approval is required.',
        }],
        claims: [{
          claimFingerprint: 'esta-claim',
          claimText: 'ESTA approval is required before travel.',
          claimType: 'entry_visa',
          riskLevel: 'HIGH',
          candidateKind: 'requirement_prohibition',
          extractedValue: {
            normalizedValue: 'ESTA required',
            unit: null,
            currency: null,
          },
        }],
      },
    });

    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        creative_id: 'review-draft-id',
        validation_status: 'supported',
        validation_reason: null,
      })],
      { onConflict: 'content_key,claim_fingerprint' },
    );
  });
});
