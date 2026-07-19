import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  rateLimitMutation: vi.fn(),
}));

vi.mock('@/lib/admin-guard', () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimitMutation: mocks.rateLimitMutation,
}));

vi.mock('@/lib/supabase', () => ({
  getBookings: vi.fn(),
  getBookingById: vi.fn(),
  createBooking: vi.fn(),
  updateBookingStatus: vi.fn(),
  updateBooking: vi.fn(),
  isSupabaseConfigured: false,
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('@/lib/kakao', () => ({ sendBalanceNotice: vi.fn() }));
vi.mock('@/lib/payment-matcher', () => ({
  matchPaymentToBookings: vi.fn(() => []),
  applyDuplicateNameGuard: vi.fn(() => []),
  classifyMatch: vi.fn(),
  calcPaymentStatus: vi.fn(),
}));
vi.mock('@/lib/push-dispatcher', () => ({ dispatchPushAsync: vi.fn() }));
vi.mock('@/lib/affiliate-ref-code', () => ({ normalizeAffiliateReferralCode: vi.fn((v) => v) }));
vi.mock('@/lib/affiliate/self-referral', () => ({ checkSelfReferral: vi.fn() }));
vi.mock('@/lib/secret-registry', () => ({ getSecret: vi.fn() }));
vi.mock('@/lib/admin-cache', () => ({ ADMIN_CACHE: { invalidate: vi.fn() } }));

import { POST } from './route';

describe('POST /api/bookings admin boundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated request before rate limiting or body processing', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );

    const response = await POST(new NextRequest('http://localhost/api/bookings', {
      method: 'POST',
      body: '{not-json',
    }));

    expect(response.status).toBe(401);
    expect(mocks.rateLimitMutation).not.toHaveBeenCalled();
  });

  it('preserves the existing post-guard flow for a legitimate admin request', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(null);
    mocks.rateLimitMutation.mockResolvedValueOnce(null);

    const response = await POST(new NextRequest('http://localhost/api/bookings', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    }));

    expect(mocks.rateLimitMutation).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
  });
});
