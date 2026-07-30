import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  insertConversionLog: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock('@/lib/cron-resource-saver', () => ({
  shouldSkipPublicDbReadsForResourceSaver: () => false,
}));

vi.mock('@/lib/secret-registry', () => ({
  getSecret: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {},
  insertTrafficLog: vi.fn(),
  insertSearchLog: vi.fn(),
  insertEngagementLog: vi.fn(),
  insertConversionLog: mocks.insertConversionLog,
  getLatestTrafficBySession: vi.fn(),
  getFirstTrafficBySession: vi.fn(),
  mergeSessionToUser: vi.fn(),
}));

describe('POST /api/tracking conversion boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(null);
  });

  it('rejects browser-supplied sales and cost values before persistence', async () => {
    const { POST } = await import('./route');
    const response = await POST(new Request('https://www.yeosonam.com/api/tracking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'conversion',
        session_id: 'session-1',
        booking_id: 'booking-1',
        final_sales_price: 9_999_999,
        base_cost: 1,
      }),
    }) as never);

    expect(response.status).toBe(403);
    expect(mocks.insertConversionLog).not.toHaveBeenCalled();
  });
});
