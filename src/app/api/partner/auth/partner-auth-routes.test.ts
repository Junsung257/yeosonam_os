import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requestOtp: vi.fn(),
  activate: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@/lib/affiliate/invitation-service', () => ({
  requestAffiliateOtp: mocks.requestOtp,
  activateAffiliateInvitation: mocks.activate,
  setPartnerSessionCookie: mocks.setCookie,
}));

import { POST as challenge } from '@/app/api/partner/auth/challenge/route';
import { POST as activate } from '@/app/api/partner/auth/activate/route';

function request(path: string, body: unknown, origin = 'https://www.yeosonam.com') {
  return new NextRequest(`https://www.yeosonam.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('partner auth routes', () => {
  it('rejects cross-origin activation writes', async () => {
    const response = await challenge(request('/api/partner/auth/challenge', { token: 'x' }, 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(mocks.requestOtp).not.toHaveBeenCalled();
  });

  it('accepts an OTP challenge without returning the OTP', async () => {
    mocks.requestOtp.mockResolvedValue({ ok: true, expiresInSeconds: 300 });
    const response = await challenge(request('/api/partner/auth/challenge', { token: 'opaque-token' }));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json).toEqual({ accepted: true, expires_in: 300 });
    expect(JSON.stringify(json)).not.toMatch(/otp|verification_code/i);
  });

  it('sets only the server session after successful activation', async () => {
    mocks.activate.mockResolvedValue({
      ok: true,
      token: 'signed-token',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      affiliate: { id: 'affiliate-id', referral_code: 'CODE' },
    });
    const response = await activate(request('/api/partner/auth/activate', { token: 'opaque-token', otp: '123456' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).not.toHaveProperty('token');
    expect(mocks.setCookie).toHaveBeenCalledWith(response, 'signed-token', expect.any(Date));
  });
});

