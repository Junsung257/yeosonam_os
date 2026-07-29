import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  findReplay: vi.fn(),
  createBooking: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('@/lib/lead-booking-request', () => ({
  findExistingLandingBookingReplay: mocks.findReplay,
  createLandingBookingRequest: mocks.createBooking,
}));

import { POST } from './route';

function createRequest(form: Record<string, unknown>) {
  const request = new Request('http://localhost/api/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      productId: 'pkg-1',
      channel: 'landing_page',
      form,
    }),
  }) as Request & { cookies: { get: () => undefined } };
  request.cookies = { get: () => undefined };
  return request as never;
}

describe('POST /api/leads customer identity boundary', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.findReplay.mockReset();
    mocks.createBooking.mockReset();
    mocks.findReplay.mockResolvedValue(null);
    mocks.createBooking.mockResolvedValue({
      booking: { id: 'booking-1' },
      customerId: null,
      idempotentReplay: false,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'leads') throw new Error(`unexpected table: ${table}`);
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'lead-1' }, error: null })),
          })),
        })),
      };
    });
  });

  it.each([
    ['placeholder name', { name: '카카오문의', phone: '010-1234-5678', privacyConsent: true }],
    ['spaced placeholder name', { name: '카카오 문의', phone: '010-1234-5678', privacyConsent: true }],
    ['placeholder phone', { name: '홍길동', phone: '-', privacyConsent: true }],
    ['phone with arbitrary text', { name: '홍길동', phone: 'call-me-010-1234-5678', privacyConsent: true }],
    ['non-explicit consent', { name: '홍길동', phone: '010-1234-5678', privacyConsent: 'true' }],
    ['missing consent', { name: '홍길동', phone: '010-1234-5678', privacyConsent: false }],
  ])('rejects %s before any replay or database mutation', async (_label, form) => {
    const response = await POST(createRequest(form));

    expect(response.status).toBe(400);
    expect(mocks.findReplay).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it('preserves a valid consented reservation inquiry', async () => {
    const response = await POST(createRequest({
      name: '홍길동',
      phone: '010-1234-5678',
      privacyConsent: true,
      message: '부모님 동행이라 낮은 피로도 일정으로 부탁드립니다.',
      adults: 2,
      children: 0,
    }));

    expect(response.status).toBe(200);
    expect(mocks.findReplay).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('leads');
    expect(mocks.createBooking).toHaveBeenCalledOnce();
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      form: expect.objectContaining({
        message: '부모님 동행이라 낮은 피로도 일정으로 부탁드립니다.',
      }),
    }));
  });
});
