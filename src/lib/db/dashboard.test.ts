import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

const {
  getDashboardStats,
  getDashboardStatsV3,
  getNewBookingsMonthly,
  getRecognizedRevenueMonthly,
  getSettlementBalances,
} = await import('./dashboard');
const { getKstCurrentAndPreviousMonthKeys } = await import('../admin-dashboard-kpi-basis');

type QueryResult = { data?: unknown[] | null; count?: number | null; error?: unknown };

function baseQuery() {
  const query = {
    select: vi.fn(),
    or: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    not: vi.fn(),
  };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  return query;
}

describe('admin dashboard KPI boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-01 00:30 KST. The UTC date is still June 30.
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z'));
    mocks.supabaseAdmin.from.mockReset();
    mocks.supabaseAdmin.rpc.mockReset();
    mocks.getSupabaseAdmin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the server-side aggregate RPC so KPI totals are not capped at 1,000 rows', async () => {
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: {
        totalSales: 1_500,
        totalCost: 1_100,
        totalPaid: 1_450,
        totalOutstanding: 100,
        margin: 400,
        activeBookings: 7,
        unpaidD7: 1,
        totalMonthBookings: 2,
        totalMileage: 0,
        expiringPassports: 2,
      },
      error: null,
    });

    const result = await getDashboardStats();

    expect(mocks.supabaseAdmin.rpc).toHaveBeenCalledWith('get_admin_dashboard_stats');
    expect(mocks.supabaseAdmin.from).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalSales: 1_500,
      totalCost: 1_100,
      totalPaid: 1_450,
      // The second booking's overpayment cannot offset the first booking's receivable.
      totalOutstanding: 100,
      margin: 400,
      activeBookings: 7,
      unpaidD7: 1,
      totalMonthBookings: 2,
      totalMileage: 0,
      expiringPassports: 2,
    });
  });

  it('bounds recognized and newly-created booking queries in KST', async () => {
    const recognized = baseQuery();
    recognized.lte.mockResolvedValue({ data: [], error: null } satisfies QueryResult);
    const recognizedClient = { from: vi.fn(() => recognized) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(recognizedClient);

    const recognizedRows = await getRecognizedRevenueMonthly(3);

    expect(recognized.gte).toHaveBeenCalledWith('month', '2026-05');
    expect(recognized.lte).toHaveBeenCalledWith('month', '2026-07');
    expect(recognizedClient.from).toHaveBeenCalledWith('v_monthly_recognized_revenue');
    expect(recognizedRows.map(row => row.month)).toEqual(['2026-05', '2026-06', '2026-07']);

    const created = baseQuery();
    created.lte.mockResolvedValue({ data: [], error: null } satisfies QueryResult);
    const createdClient = { from: vi.fn(() => created) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(createdClient);

    const createdRows = await getNewBookingsMonthly(3);

    expect(created.gte).toHaveBeenCalledWith('month', '2026-05');
    expect(created.lte).toHaveBeenCalledWith('month', '2026-07');
    expect(createdClient.from).toHaveBeenCalledWith('v_monthly_new_bookings');
    expect(createdRows.map(row => row.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('bounds the cashflow chart at KST today and keeps browser month keys on the same calendar', async () => {
    const bookings = baseQuery();
    bookings.lte.mockResolvedValue({
      data: [{
        month: '2026-07',
        direct_sales: 1_000,
        affiliate_sales: 500,
        direct_margin: 200,
        affiliate_margin: 120,
        total_commission: 80,
      }],
      error: null,
    } satisfies QueryResult);
    const snapshots = baseQuery();
    snapshots.lte.mockResolvedValue({
      data: [{ month: '2026-07', ad_spend_krw: 50 }],
      error: null,
    } satisfies QueryResult);
    const client = { from: vi.fn().mockReturnValueOnce(bookings).mockReturnValueOnce(snapshots) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);

    const result = await getDashboardStatsV3(3);

    expect(bookings.gte).toHaveBeenCalledWith('month', '2026-05');
    expect(bookings.lte).toHaveBeenCalledWith('month', '2026-07');
    expect(client.from).toHaveBeenNthCalledWith(1, 'v_monthly_dashboard_profit');
    expect(client.from).toHaveBeenNthCalledWith(2, 'v_monthly_ad_spend');
    expect(snapshots.lte).toHaveBeenCalledWith('month', '2026-07');
    expect(result.map(row => row.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(result.at(-1)).toMatchObject({
      direct_sales: 1_000,
      affiliate_sales: 500,
      total_commission: 80,
      ad_spend_krw: 50,
      // DB margin(200 + 120)에 이미 수수료가 반영되므로 광고비만 추가 차감한다.
      net_margin: 270,
    });
    expect(getKstCurrentAndPreviousMonthKeys()).toEqual({
      current: '2026-07',
      previous: '2026-06',
    });
  });

  it('uses the uncapped server aggregate for settlement balances', async () => {
    const payload = {
      cash: { received: 1_900, paid_out: 900, balance: 1_000, basis: 'all_time_non_deleted_bookings' },
      receivable: {
        total: 400,
        aging: [
          { bucket: 'not_due', amount: 0 },
          { bucket: '0-30d', amount: 400 },
          { bucket: '30-60d', amount: 0 },
          { bucket: '60-90d', amount: 0 },
          { bucket: '90d+', amount: 0 },
        ],
      },
      payable: {
        total: 500,
        aging: [
          { bucket: 'not_due', amount: 0 },
          { bucket: '0-30d', amount: 500 },
          { bucket: '30-60d', amount: 0 },
          { bucket: '60-90d', amount: 0 },
          { bucket: '90d+', amount: 0 },
        ],
      },
    };
    const client = { rpc: vi.fn().mockResolvedValue({ data: payload, error: null }) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);

    const result = await getSettlementBalances();

    expect(client.rpc).toHaveBeenCalledWith('get_admin_settlement_balances');
    expect(result.cash).toEqual({
      received: 1_900,
      paid_out: 900,
      balance: 1_000,
      basis: 'all_time_non_deleted_bookings',
    });
    expect(result.receivable.total).toBe(400);
    expect(result.receivable.aging.find(row => row.bucket === 'not_due')?.amount).toBe(0);
    expect(result.payable.total).toBe(500);
  });

  it('classifies future receivables as not due instead of overdue', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          cash: { received: 400, paid_out: 0, balance: 400, basis: 'all_time_non_deleted_bookings' },
          receivable: {
            total: 600,
            aging: [
              { bucket: 'not_due', amount: 600 },
              { bucket: '0-30d', amount: 0 },
              { bucket: '30-60d', amount: 0 },
              { bucket: '60-90d', amount: 0 },
              { bucket: '90d+', amount: 0 },
            ],
          },
          payable: {
            total: 0,
            aging: [
              { bucket: 'not_due', amount: 0 },
              { bucket: '0-30d', amount: 0 },
              { bucket: '30-60d', amount: 0 },
              { bucket: '60-90d', amount: 0 },
              { bucket: '90d+', amount: 0 },
            ],
          },
        },
        error: null,
      }),
    };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);

    const result = await getSettlementBalances();

    expect(result.receivable.aging.find(row => row.bucket === 'not_due')?.amount).toBe(600);
    expect(result.receivable.aging.find(row => row.bucket === '0-30d')?.amount).toBe(0);
    expect(result.payable.total).toBe(0);
  });

  it('propagates chart query failures instead of rendering a healthy zero chart', async () => {
    const dbError = new Error('dashboard chart unavailable');
    const bookings = baseQuery();
    bookings.lte.mockResolvedValue({ data: null, error: dbError } satisfies QueryResult);
    const snapshots = baseQuery();
    snapshots.lte.mockResolvedValue({ data: [], error: null } satisfies QueryResult);
    const client = { from: vi.fn().mockReturnValueOnce(bookings).mockReturnValueOnce(snapshots) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(getDashboardStatsV3(3)).rejects.toBe(dbError);

    consoleError.mockRestore();
  });

  it('propagates settlement DB failures instead of returning an all-zero balance', async () => {
    const dbError = new Error('settlement db unavailable');
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: dbError }) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(getSettlementBalances()).rejects.toBe(dbError);

    consoleError.mockRestore();
  });

  it('keeps the fast RPC on the same KST closed-range contract', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20260719172000_admin_dashboard_kpi_kst_bounds.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("now() AT TIME ZONE 'Asia/Seoul'");
    expect(sql).toContain('b.departure_date BETWEEN bounds.month_start AND bounds.today');
    expect(sql).toContain("b.status IN ('pending', 'confirmed')");
    expect(sql).toContain('sum(greatest(');
    expect(sql).not.toContain('b.departure_date >= bounds.month_start\n  ');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()');
    expect(sql).toContain('RETURNS jsonb');
    for (const key of [
      'totalSales', 'totalCost', 'totalPaid', 'totalOutstanding', 'margin',
      'activeBookings', 'unpaidD7', 'totalMonthBookings', 'totalMileage', 'expiringPassports',
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
  });

  it('keeps the shared KPI view on KST and floors each booking receivable at zero', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20260722150310_admin_dashboard_kpi_view_accuracy.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("now() AT TIME ZONE 'Asia/Seoul'");
    expect(sql).toContain("to_char((b.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM')");
    expect(sql).toContain('GREATEST(0, COALESCE(b.total_price, 0) - COALESCE(b.paid_amount, 0)) AS outstanding');
    expect(sql).toContain('ALTER VIEW public.v_bookings_kpi SET (security_invoker = on)');
    expect(sql).toContain('ALTER VIEW public.v_monthly_recognized_revenue SET (security_invoker = on)');
    expect(sql).toContain('ALTER VIEW public.v_monthly_new_bookings SET (security_invoker = on)');
    expect(sql).toContain('CREATE OR REPLACE VIEW public.v_monthly_dashboard_profit');
    expect(sql).toContain('CREATE OR REPLACE VIEW public.v_monthly_ad_spend');
  });

  it('keeps operations KPI aggregates server-side and service-role-only', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20260722230001_admin_operations_kpi_aggregates.sql', import.meta.url),
      'utf8',
    );

    for (const functionName of [
      'get_admin_settlement_balances',
      'get_admin_booking_pace_and_cancellation',
      'get_admin_operator_take_rates',
      'get_admin_repeat_booking_stats',
      'get_admin_data_quality_counts',
      'get_admin_ai_usage_stats',
      'get_admin_ai_month_usage_by_provider',
    ]) {
      expect(sql).toContain(`FUNCTION public.${functionName}`);
    }
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain("'not_due'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_admin_settlement_balances() FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_admin_settlement_balances() TO service_role');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_admin_ai_month_usage_by_provider() TO service_role');
  });

  it('keeps every admin dashboard RPC out of direct browser roles', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20260722234056_revoke_admin_dashboard_stats_public.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_admin_badge_counts() FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_capital_total() FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_pending_agent_actions_compact(integer) FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain('ALTER FUNCTION public.get_admin_badge_counts() SECURITY INVOKER');
    expect(sql).toContain('GRANT SELECT ON TABLE');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO service_role');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_admin_badge_counts() TO service_role');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_capital_total() TO service_role');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_pending_agent_actions_compact(integer) TO service_role',
    );
  });

  it('renders an explicit review state when settlement data is unavailable', () => {
    const client = readFileSync(
      new URL('../../app/admin/AdminPageClient.tsx', import.meta.url),
      'utf8',
    );

    expect(client).toContain("type SettlementLoadStatus = 'loading' | 'ok' | 'error' | 'timeout' | 'unconfigured'");
    expect(client).toContain('조회 실패 · 확인 필요');
    expect(client).toContain("setSettlementStatus('error')");
  });
});
