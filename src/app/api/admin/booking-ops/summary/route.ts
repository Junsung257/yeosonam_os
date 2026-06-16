import { NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  buildBookingOpsRuleHealth,
  groupBookingOpsActions,
  sortBookingOpsActions,
  toBookingOpsAction,
  type BookingOpsRuleTaskInput,
  type BookingOpsSummary,
} from '@/lib/booking-ops';
import {
  applyDuplicateNameGuard,
  classifyMatch,
  matchPaymentToBookings,
  type BookingCandidate,
} from '@/lib/payment-matcher';
import type { InboxTaskRow } from '@/types/booking-tasks';

type HealthRow = {
  urgent_open?: number | null;
  high_open?: number | null;
  normal_open?: number | null;
  low_open?: number | null;
  total_open?: number | null;
  snoozed_count?: number | null;
  stale_over_48h?: number | null;
  auto_resolved_last_24h?: number | null;
  manually_resolved_last_24h?: number | null;
};

type BankHealthRow = {
  unmatched_count?: number | null;
  review_count?: number | null;
  error_count?: number | null;
  stale_over_24h?: number | null;
};

type StatRow = {
  auto_resolved_count?: number | null;
  manual_resolved_count?: number | null;
};

type BookingKpiRow = {
  status?: string | null;
  is_deleted?: boolean | null;
  total_price?: number | null;
  paid_amount?: number | null;
};

type BankTransactionRow = {
  id: string;
  amount: number | null;
  counterparty_name: string | null;
  received_at: string | null;
  match_status: string | null;
  transaction_type: string | null;
};

type ActiveBookingRow = {
  id: string;
  booking_no?: string | null;
  package_title?: string | null;
  total_price?: number | null;
  total_cost?: number | null;
  paid_amount?: number | null;
  total_paid_out?: number | null;
  status: string;
  payment_status?: string | null;
  actual_payer_name?: string | null;
  customers?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

const EMPTY_SUMMARY: BookingOpsSummary = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    urgentOpen: 0,
    todayOpen: 0,
    normalOpen: 0,
    lowOpen: 0,
    totalOpen: 0,
    snoozed: 0,
    staleOver48h: 0,
    autoResolved24h: 0,
    manualResolved24h: 0,
    unmatchedBank: 0,
    bankReview: 0,
    bankErrors: 0,
    bankStaleOver24h: 0,
    activeBookings: 0,
    totalSales: 0,
    totalPaid: 0,
    totalBalance: 0,
    autoResolveRatePct: 0,
  },
  actions: [],
  highlightedAction: null,
  paymentMatchCandidates: [],
  ruleHealth: [],
};

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function customerName(row: ActiveBookingRow): string | undefined {
  const customers = row.customers;
  if (Array.isArray(customers)) return customers[0]?.name ?? undefined;
  return customers?.name ?? undefined;
}

function toBookingCandidate(row: ActiveBookingRow): BookingCandidate {
  return {
    id: row.id,
    booking_no: row.booking_no ?? undefined,
    package_title: row.package_title ?? undefined,
    total_price: num(row.total_price),
    total_cost: num(row.total_cost),
    paid_amount: num(row.paid_amount),
    total_paid_out: num(row.total_paid_out),
    status: row.status,
    payment_status: row.payment_status ?? undefined,
    actual_payer_name: row.actual_payer_name ?? null,
    customer_name: customerName(row),
  };
}

async function safe<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const result = await promise;
    return result.error ? null : result.data ?? null;
  } catch {
    return null;
  }
}

const getHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ...EMPTY_SUMMARY, generatedAt: new Date().toISOString() });
  }

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? '12')));
    const bookingId = searchParams.get('booking_id');
    const taskId = searchParams.get('task_id') ?? searchParams.get('task');
    const now = new Date();

    const [tasksRaw, healthRaw, bankRaw, statsRaw, bookingsRaw, bankTxRaw, activeBookingsRaw, ruleTasksRaw] = await Promise.all([
      safe<InboxTaskRow[]>(
        supabaseAdmin.rpc('get_inbox_tasks', {
          p_priority_max: 3,
          p_limit: bookingId || taskId ? 200 : Math.max(limit * 4, 50),
          p_offset: 0,
        }),
      ),
      safe<HealthRow[]>(
        supabaseAdmin.from('booking_tasks_health').select('*').limit(1),
      ),
      safe<BankHealthRow[]>(
        supabaseAdmin
          .from('bank_tx_health')
          .select('unmatched_count, review_count, error_count, stale_over_24h')
          .limit(1),
      ),
      safe<StatRow[]>(
        supabaseAdmin
          .from('booking_task_resolution_stats')
          .select('auto_resolved_count, manual_resolved_count'),
      ),
      safe<BookingKpiRow[]>(
        supabaseAdmin
          .from('bookings')
          .select('status, is_deleted, total_price, paid_amount')
          .limit(1000),
      ),
      safe<BankTransactionRow[]>(
        supabaseAdmin
          .from('bank_transactions')
          .select('id, amount, counterparty_name, received_at, match_status, transaction_type')
          .in('match_status', ['unmatched', 'review'])
          .neq('status', 'excluded')
          .order('received_at', { ascending: false })
          .limit(8),
      ),
      safe<ActiveBookingRow[]>(
        supabaseAdmin
          .from('bookings')
          .select('id, booking_no, package_title, total_price, total_cost, paid_amount, total_paid_out, status, payment_status, actual_payer_name, customers!lead_customer_id(name)')
          .in('status', ['pending', 'confirmed'])
          .eq('is_deleted', false)
          .limit(500),
      ),
      safe<BookingOpsRuleTaskInput[]>(
        supabaseAdmin
          .from('booking_tasks')
          .select('task_type, status, created_at, resolved_at, resolution')
          .order('created_at', { ascending: false })
          .limit(5000),
      ),
    ]);

    const rawActions = sortBookingOpsActions(
      (tasksRaw ?? []).map((task) => toBookingOpsAction(task, now)),
    );
    const allActions = groupBookingOpsActions(rawActions);
    const scopedActions = allActions.filter((action) => {
      if (bookingId && action.bookingId !== bookingId) return false;
      return true;
    });
    const highlightedAction =
      (taskId
        ? rawActions.find((action) => action.id === taskId)
          ?? allActions.find((action) => action.id === taskId || action.relatedActions.some((related) => related.id === taskId))
        : null) ?? null;
    const actions = (bookingId || taskId ? scopedActions : allActions).slice(0, limit);

    const health = healthRaw?.[0] ?? {};
    const bank = bankRaw?.[0] ?? {};
    const stats = statsRaw ?? [];
    const bookings = (bookingsRaw ?? []).filter((row) => row.is_deleted !== true);
    const activeBookings = bookings.filter((row) =>
      row.status === 'pending' || row.status === 'confirmed',
    ).length;
    const totalSales = bookings.reduce((sum, row) => sum + num(row.total_price), 0);
    const totalPaid = bookings.reduce((sum, row) => sum + num(row.paid_amount), 0);
    const totalBalance = bookings.reduce(
      (sum, row) => sum + Math.max(0, num(row.total_price) - num(row.paid_amount)),
      0,
    );
    const autoResolved = stats.reduce((sum, row) => sum + num(row.auto_resolved_count), 0);
    const manualResolved = stats.reduce((sum, row) => sum + num(row.manual_resolved_count), 0);
    const resolvedTotal = autoResolved + manualResolved;
    const activeBookingCandidates = (activeBookingsRaw ?? []).map(toBookingCandidate);
    const paymentMatchCandidates = (bankTxRaw ?? [])
      .filter((tx) => num(tx.amount) > 0 && (!tx.transaction_type || tx.transaction_type === '입금'))
      .map((tx) => {
        const candidates = applyDuplicateNameGuard(matchPaymentToBookings({
          amount: num(tx.amount),
          senderName: tx.counterparty_name,
          bookings: activeBookingCandidates,
        })).slice(0, 3);

        return {
          transactionId: tx.id,
          amount: num(tx.amount),
          counterpartyName: tx.counterparty_name,
          receivedAt: tx.received_at,
          matchStatus: tx.match_status,
          topConfidence: Math.round((candidates[0]?.confidence ?? 0) * 100),
          candidates: candidates.map((candidate) => ({
            bookingId: candidate.booking.id,
            bookingNo: candidate.booking.booking_no ?? null,
            customerName: candidate.booking.customer_name ?? null,
            packageTitle: candidate.booking.package_title ?? null,
            confidence: Math.round(candidate.confidence * 100),
            matchClass: classifyMatch(candidate.confidence),
            reasons: candidate.reasons.slice(0, 3),
          })),
        };
      })
      .filter((item) => item.candidates.length > 0)
      .sort((a, b) => b.topConfidence - a.topConfidence)
      .slice(0, 5);
    const ruleHealth = buildBookingOpsRuleHealth(ruleTasksRaw ?? [], now);

    const summary: BookingOpsSummary = {
      generatedAt: now.toISOString(),
      metrics: {
        urgentOpen: num(health.urgent_open),
        todayOpen: num(health.high_open),
        normalOpen: num(health.normal_open),
        lowOpen: num(health.low_open),
        totalOpen: num(health.total_open),
        snoozed: num(health.snoozed_count),
        staleOver48h: num(health.stale_over_48h),
        autoResolved24h: num(health.auto_resolved_last_24h),
        manualResolved24h: num(health.manually_resolved_last_24h),
        unmatchedBank: num(bank.unmatched_count),
        bankReview: num(bank.review_count),
        bankErrors: num(bank.error_count),
        bankStaleOver24h: num(bank.stale_over_24h),
        activeBookings,
        totalSales,
        totalPaid,
        totalBalance,
        autoResolveRatePct: resolvedTotal > 0 ? Math.round((autoResolved / resolvedTotal) * 1000) / 10 : 0,
      },
      actions,
      highlightedAction,
      paymentMatchCandidates,
      ruleHealth,
    };

    return apiResponse(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
