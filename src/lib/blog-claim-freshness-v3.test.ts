import { describe, expect, it } from 'vitest';
import { applyBlogUpdateTimestampsV3, evaluateBlogClaimFreshnessV3 } from './blog-claim-freshness-v3';

describe('claim freshness and material updates v3', () => {
  it('blocks expired medium-risk claims and requires expiry', () => {
    expect(evaluateBlogClaimFreshnessV3({
      riskLevel: 'MEDIUM', verificationStatus: 'supported', sourceType: 'transport_operator',
      expiresAt: '2026-08-01T00:00:00Z',
    }, new Date('2026-08-11T00:00:00Z'))).toMatchObject({ publishable: false, stale: true });
  });

  it('requires primary evidence, no conflict and approval for high risk', () => {
    const result = evaluateBlogClaimFreshnessV3({
      riskLevel: 'HIGH', verificationStatus: 'supported', sourceType: 'reputable_source',
      conflictStatus: 'confirmed',
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      'claim_source_conflict', 'high_risk_primary_source_required', 'high_risk_human_approval_required',
    ]));
  });

  it('does not change dateModified for cosmetic edits', () => {
    expect(applyBlogUpdateTimestampsV3({
      kind: 'cosmetic', previousContentModifiedAt: '2026-07-01T00:00:00Z',
      previousFactCheckedAt: '2026-06-01T00:00:00Z', now: '2026-08-11T00:00:00Z',
    })).toMatchObject({
      contentModifiedAt: '2026-07-01T00:00:00Z', factCheckedAt: '2026-06-01T00:00:00Z',
    });
  });
});
