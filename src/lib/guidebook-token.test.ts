import { afterEach, describe, expect, it, vi } from 'vitest';
import { signGuidebookToken, verifyGuidebookToken } from './guidebook-token';

describe('guidebook token signing key boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs and verifies with the dedicated guidebook secret', () => {
    vi.stubEnv('GUIDEBOOK_TOKEN_SECRET', 'test-guidebook-signing-secret');

    const token = signGuidebookToken({ bookingId: 'booking-1' });

    expect(verifyGuidebookToken(token)).toMatchObject({
      bookingId: 'booking-1',
      scope: 'guide:read',
    });
  });

  it('does not reuse the service-role key or a hardcoded development secret', () => {
    vi.stubEnv('GUIDEBOOK_TOKEN_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-is-not-a-token-signing-key');

    expect(() => signGuidebookToken({ bookingId: 'booking-1' })).toThrow(
      'GUIDEBOOK_TOKEN_SECRET is required',
    );
    expect(verifyGuidebookToken('body.signature')).toBeNull();
  });
});
