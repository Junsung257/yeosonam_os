import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: { from: vi.fn() },
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

const {
  getDashboardStats,
  getNewBookingsMonthly,
  getRecognizedRevenueMonthly,
  getSettlementBalances,
} = await import('./dashboard');

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
    mocks.getSupabaseAdmin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a closed KST recognized-month range while keeping future active bookings operational', async () => {
    const recognized = baseQuery();
    recognized.lte.mockResolvedValue({
      data: [
        { total_price: 1_000, total_cost: 700, paid_amount: 900, margin: 300 },
        { total_price: 500, total_cost: 400, paid_amount: 550, margin: 100 },
      ],
      error: null,
    } satisfies QueryResult);

    const active = baseQuery();
    active.in.mockResolvedValue({ data: null, count: 7, error: null } satisfies QueryResult);

    const unpaidD7 = baseQuery();
    unpaidD7.lte.mockResolvedValue({
      data: [
        { total_price: 1_000, paid_amount: 500 },
        { total_price: 700, paid_amount: 700 },
      ],
      error: null,
    } satisfies QueryResult);

    const passports = baseQuery();
    passports.lte.mockResolvedValue({ data: null, count: 2, error: null } satisfies QueryResult);

    mocks.supabaseAdmin.from
      .mockReturnValueOnce(recognized)
      .mockReturnValueOnce(active)
      .mockReturnValueOnce(unpaidD7)
      .mockReturnValueOnce(passports);

    const result = await getDashboardStats();

    expect(recognized.gte).toHaveBeenCalledWith('departure_date', '2026-07-01');
    expect(recognized.lte).toHaveBeenCalledWith('departure_date', '2026-07-01');
    expect(active.in).toHaveBeenCalledWith('status', ['pending', 'confirmed']);
    expect(unpaidD7.gte).toHaveBeenCalledWith('departure_date', '2026-07-01');
    expect(unpaidD7.lte).toHaveBeenCalledWith('departure_date', '2026-07-08');
    expect(passports.lte).toHaveBeenCalledWith('passport_expiry', '2026-12-28');
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
    recognized.or.mockResolvedValue({ data: [], error: null } satisfies QueryResult);
    const recognizedClient = { from: vi.fn(() => recognized) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(recognizedClient);

    const recognizedRows = await getRecognizedRevenueMonthly(3);

    expect(recognized.gte).toHaveBeenCalledWith('departure_date', '2026-05-01');
    expect(recognized.lte).toHaveBeenCalledWith('departure_date', '2026-07-01');
    expect(recognizedRows.map(row => row.month)).toEqual(['2026-05', '2026-06', '2026-07']);

    const created = baseQuery();
    created.or.mockResolvedValue({ data: [], error: null } satisfies QueryResult);
    const createdClient = { from: vi.fn(() => created) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(createdClient);

    const createdRows = await getNewBookingsMonthly(3);

    expect(created.gte).toHaveBeenCalledWith('created_at', '2026-04-30T15:00:00.000Z');
    expect(created.lte).toHaveBeenCalledWith('created_at', '2026-06-30T15:30:00.000Z');
    expect(createdRows.map(row => row.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('uses one all-time non-deleted basis for booking cash and excludes cancellations only from settlement balances', async () => {
    const query = baseQuery();
    query.or.mockResolvedValue({
      data: [
        { status: 'confirmed', departure_date: '2026-06-30', total_price: 1_000, paid_amount: 600, total_cost: 700, total_paid_out: 200 },
        { status: 'confirmed', departure_date: '2026-07-20', total_price: 500, paid_amount: 500, total_cost: 300, total_paid_out: 0 },
        { status: 'cancelled', departure_date: '2026-06-01', total_price: 800, paid_amount: 800, total_cost: 600, total_paid_out: 700 },
      ],
      error: null,
    } satisfies QueryResult);
    const client = { from: vi.fn(() => query) };
    mocks.getSupabaseAdmin.mockReturnValueOnce(client);

    const result = await getSettlementBalances();

    expect(query.neq).not.toHaveBeenCalledWith('status', 'cancelled');
    expect(result.cash).toEqual({
      received: 1_900,
      paid_out: 900,
      balance: 1_000,
      basis: 'all_time_non_deleted_bookings',
    });
    expect(result.receivable.total).toBe(400);
    expect(result.payable.total).toBe(500);
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
});
