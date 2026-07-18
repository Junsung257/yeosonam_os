import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isValidAdminApiToken: vi.fn(),
  legacyJwtExpValid: vi.fn(),
  verifySupabaseAccessToken: vi.fn(),
  getDashboardStatsV3: vi.fn(),
  getRecognizedRevenueMonthly: vi.fn(),
  getNewBookingsMonthly: vi.fn(),
  getBookingPaceAndCancellation: vi.fn(),
  getAIUsageStats: vi.fn(),
  getSettlementBalances: vi.fn(),
  getOperatorTakeRates: vi.fn(),
  getRepeatBookingStats: vi.fn(),
  getDataQualityIssues: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  isValidAdminApiToken: mocks.isValidAdminApiToken,
}));

vi.mock('@/lib/supabase-jwt-verify', () => ({
  legacyJwtExpValid: mocks.legacyJwtExpValid,
  verifySupabaseAccessToken: mocks.verifySupabaseAccessToken,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getDashboardStatsV3: mocks.getDashboardStatsV3,
  getRecognizedRevenueMonthly: mocks.getRecognizedRevenueMonthly,
  getNewBookingsMonthly: mocks.getNewBookingsMonthly,
  getBookingPaceAndCancellation: mocks.getBookingPaceAndCancellation,
  getAIUsageStats: mocks.getAIUsageStats,
  getSettlementBalances: mocks.getSettlementBalances,
  getOperatorTakeRates: mocks.getOperatorTakeRates,
  getRepeatBookingStats: mocks.getRepeatBookingStats,
  getDataQualityIssues: mocks.getDataQualityIssues,
}));

const { GET: getChart } = await import('./chart/route');
const { GET: getRevenueRecognition } = await import('./revenue-recognition/route');
const { GET: getOperations } = await import('./operations/route');

const handlers = [
  ['chart', getChart, 'http://localhost/api/dashboard/chart?months=6'],
  ['revenue-recognition', getRevenueRecognition, 'http://localhost/api/dashboard/revenue-recognition?months=6'],
  ['operations', getOperations, 'http://localhost/api/dashboard/operations?mode=dashboard'],
] as const;

function request(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { cookie: 'sb-access-token=valid-user-token' },
  });
}

function expectPrivateNoStore(response: Response): void {
  const cacheControl = response.headers.get('cache-control') ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
}

describe('dashboard sub-route admin boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_EMAILS', 'admin@yeosonam.com');
    vi.clearAllMocks();
    mocks.isValidAdminApiToken.mockReturnValue(false);
    mocks.legacyJwtExpValid.mockReturnValue(true);
    mocks.getDashboardStatsV3.mockResolvedValue([]);
    mocks.getRecognizedRevenueMonthly.mockResolvedValue([]);
    mocks.getNewBookingsMonthly.mockResolvedValue([]);
    mocks.getBookingPaceAndCancellation.mockResolvedValue({
      pace: [],
      cancellation_90d: { total_in_window: 0, cancelled_in_window: 0, rate: 0 },
    });
    mocks.getAIUsageStats.mockResolvedValue(null);
    mocks.getSettlementBalances.mockResolvedValue({
      cash: { received: 100, paid_out: 40, balance: 60, basis: 'all_time_non_deleted_bookings' },
      payable: { total: 0, aging: [] },
      receivable: { total: 0, aging: [] },
    });
    mocks.getOperatorTakeRates.mockResolvedValue([]);
    mocks.getRepeatBookingStats.mockResolvedValue(null);
    mocks.getDataQualityIssues.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(handlers)('rejects an authenticated non-admin JWT on %s before KPI work', async (_name, handler, url) => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { email: 'traveler@example.com' },
    });

    const response = await handler(request(url));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
    expectPrivateNoStore(response);
    expect(mocks.getDashboardStatsV3).not.toHaveBeenCalled();
    expect(mocks.getRecognizedRevenueMonthly).not.toHaveBeenCalled();
    expect(mocks.getSettlementBalances).not.toHaveBeenCalled();
  });

  it.each(handlers)('allows an administrator on %s and marks the payload private', async (_name, handler, url) => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { email: 'admin@yeosonam.com' },
    });

    const response = await handler(request(url));

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
  });

  it('reports settlement query errors instead of returning a zero balance', async () => {
    mocks.verifySupabaseAccessToken.mockResolvedValue({
      ok: true,
      payload: { email: 'admin@yeosonam.com' },
    });
    mocks.getSettlementBalances.mockRejectedValue(new Error('db unavailable'));

    const response = await getOperations(request('http://localhost/api/dashboard/operations?mode=dashboard'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(body).toMatchObject({ settlement: null, settlementStatus: 'error' });
  });
});
