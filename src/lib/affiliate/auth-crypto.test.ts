import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptAffiliateOutboxPayload,
  encryptAffiliateOutboxPayload,
  generateAffiliateOtp,
  generateInvitationToken,
  hashAffiliateOtp,
  hashOpaqueValue,
} from '@/lib/affiliate/auth-crypto';

const TEST_SECRET = 'affiliate-auth-test-secret-with-at-least-32-characters';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('affiliate auth crypto', () => {
  it('creates high-entropy invitation tokens and stores only fixed hashes', () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', TEST_SECRET);
    const first = generateInvitationToken();
    const second = generateInvitationToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashOpaqueValue(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueValue(first)).not.toContain(first);
  });

  it('creates six-digit OTPs bound to an invitation', () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', TEST_SECRET);
    const otp = generateAffiliateOtp();
    expect(otp).toMatch(/^\d{6}$/);
    expect(hashAffiliateOtp('invitation-a', otp)).not.toBe(hashAffiliateOtp('invitation-b', otp));
  });

  it('encrypts retry payloads without exposing the phone or activation token', () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', TEST_SECRET);
    const payload = {
      kind: 'affiliate_invitation',
      phone: '01012345678',
      activationUrl: 'https://www.yeosonam.com/partner/activate?token=secret-token',
    };
    const encrypted = encryptAffiliateOutboxPayload(payload);

    expect(encrypted).not.toContain(payload.phone);
    expect(encrypted).not.toContain('secret-token');
    expect(decryptAffiliateOutboxPayload(encrypted)).toEqual(payload);
  });

  it('fails closed when the dedicated secret is missing', () => {
    vi.stubEnv('AFFILIATE_AUTH_SECRET', '');
    expect(() => encryptAffiliateOutboxPayload({ value: 'x' }))
      .toThrow('AFFILIATE_AUTH_SECRET');
  });
});

