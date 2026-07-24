import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: fromMock,
  },
}));

import { persistBlogInformationClaimFindings } from './blog-information-claim-publish-gate';

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
});
