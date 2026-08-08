import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueAffiliateToken, verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';

afterEach(() => vi.unstubAllEnvs());

describe('affiliate session JWT', () => {
  it('binds a signed token to sid, jti and token_version', async () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', 'affiliate-auth-test-secret-with-at-least-32-characters');
    const expiresAt = new Date(Date.now() + 60_000);
    const token = await issueAffiliateToken({
      affiliateId: '00000000-0000-0000-0000-000000000001',
      referralCode: 'PARTNER_A',
      name: '파트너 A',
      sessionId: '00000000-0000-0000-0000-000000000002',
      jti: '00000000-0000-0000-0000-000000000003',
      tokenVersion: 4,
      expiresAt,
    });
    const verified = await verifyAffiliateToken(token);

    expect(verified).toMatchObject({
      ok: true,
      affiliateId: '00000000-0000-0000-0000-000000000001',
      code: 'PARTNER_A',
      sessionId: '00000000-0000-0000-0000-000000000002',
      jti: '00000000-0000-0000-0000-000000000003',
      tokenVersion: 4,
    });
  });

  it('rejects a token after the auth secret changes', async () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', 'affiliate-auth-test-secret-with-at-least-32-characters');
    const token = await issueAffiliateToken({
      affiliateId: 'a', referralCode: 'A', name: 'A', sessionId: 'b', jti: 'c',
      tokenVersion: 1, expiresAt: new Date(Date.now() + 60_000),
    });
    vi.stubEnv('AFFILIATE_AUTH_SECRET', 'a-different-affiliate-auth-secret-with-32-characters');
    await expect(verifyAffiliateToken(token)).resolves.toEqual({ ok: false, error: 'INVALID_SESSION_TOKEN' });
  });
});

