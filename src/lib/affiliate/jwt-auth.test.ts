import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueAffiliateToken, verifyAffiliateToken } from './jwt-auth';

describe('affiliate JWT signing key boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues and verifies a token with the dedicated signing key', async () => {
    vi.stubEnv('AFFILIATE_JWT_SECRET', 'test-affiliate-signing-secret');

    const token = await issueAffiliateToken({
      id: 'affiliate-1',
      referral_code: 'PARTNER1',
      name: 'Partner',
    });

    await expect(verifyAffiliateToken(token)).resolves.toEqual({
      ok: true,
      affiliateId: 'affiliate-1',
      code: 'PARTNER1',
      name: 'Partner',
    });
  });

  it('does not derive a signing key from invitation codes or a hardcoded fallback', async () => {
    vi.stubEnv('AFFILIATE_JWT_SECRET', '');
    vi.stubEnv('AFFILIATE_INVITE_CODES', 'predictable-invitation-code');

    await expect(
      issueAffiliateToken({
        id: 'affiliate-1',
        referral_code: 'PARTNER1',
        name: 'Partner',
      }),
    ).rejects.toThrow('AFFILIATE_JWT_SECRET is required');

    await expect(verifyAffiliateToken('not-a-token')).resolves.toEqual({
      ok: false,
      error: '토큰 검증 실패',
    });
  });
});
