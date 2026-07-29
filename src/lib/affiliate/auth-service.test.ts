import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashAffiliatePin } from './pin-hash';

describe('affiliate PIN HMAC key boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hashes a PIN only when the dedicated affiliate secret exists', () => {
    vi.stubEnv('AFFILIATE_JWT_SECRET', 'affiliate-test-secret');

    expect(hashAffiliatePin('1234')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not fall back to Supabase JWT or a hardcoded development key', () => {
    vi.stubEnv('AFFILIATE_JWT_SECRET', '');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'predictable-shared-secret');

    expect(() => hashAffiliatePin('1234')).toThrow('AFFILIATE_JWT_SECRET is required');
  });
});
