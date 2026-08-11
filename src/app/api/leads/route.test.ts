import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  findReplay: vi.fn(),
  createBooking: vi.fn(),
  recordServerAnalyticsEvent: vi.fn(),
  leadInsert: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock('@/lib/lead-booking-request', () => ({
  findExistingLandingBookingReplay: mocks.findReplay,
  createLandingBookingRequest: mocks.createBooking,
}));

vi.mock('@/lib/analytics/server-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics/server-events')>();
  return {
    ...actual,
    recordServerAnalyticsEvent: mocks.recordServerAnalyticsEvent,
  };
});

import { POST } from './route';

function createRequest(form: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const request = new Request('http://localhost/api/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      productId: 'pkg-1',
      channel: 'landing_page',
      form,
      ...extra,
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
    mocks.recordServerAnalyticsEvent.mockReset();
    mocks.leadInsert.mockReset();
    mocks.findReplay.mockResolvedValue(null);
    mocks.createBooking.mockResolvedValue({
      booking: { id: 'booking-1' },
      customerId: null,
      idempotentReplay: false,
    });
    mocks.recordServerAnalyticsEvent.mockResolvedValue({ id: 'event-1', idempotent: false });
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'leads') throw new Error(`unexpected table: ${table}`);
      return {
        insert: mocks.leadInsert.mockImplementation(() => ({
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

  it('records a consented blog-assisted lead without raw search query text', async () => {
    const assistingContentCreativeId = '10000000-0000-4000-8000-000000000001';
    const response = await POST(createRequest({
      name: 'Hong Gildong',
      phone: '010-1234-5678',
      privacyConsent: true,
      adults: 2,
      children: 0,
    }, {
      assistingContentCreativeId,
      attribution: {
        version: 1,
        attributionSessionId: '20000000-0000-4000-8000-000000000002',
        lastTouch: { term: 'osaka hotel area', landingPath: '/blog/osaka-hotel-area' },
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordServerAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'generate_lead',
      idempotencyKey: 'lead:lead-1',
      sourceType: 'lead',
      sourceId: 'lead-1',
      productId: 'pkg-1',
      assistingContentCreativeId,
      searchQueryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      payload: expect.objectContaining({ assisted_by_blog: true }),
    }));
    expect(mocks.recordServerAnalyticsEvent.mock.calls[0]?.[0]?.payload).not.toHaveProperty('search_query');
    expect(mocks.leadInsert).toHaveBeenCalledWith(expect.objectContaining({
      assisting_content_creative_id: assistingContentCreativeId,
      search_query_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
});
