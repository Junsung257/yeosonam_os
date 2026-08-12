import { loadFinanceCenterSummary } from '@/lib/finance-center-service';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';
import {
  buildFinanceWorkday,
  scopeTravelActionTransactionIds,
  type FinanceTravelActionScopeRow,
  type FinanceWorkday,
} from '@/lib/finance-workday';
import { previousCompletedKoreaMonth } from '@/lib/monthly-settlement-close';
import { supabaseAdmin } from '@/lib/supabase';

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function loadFinanceWorkday(taxRate = 0.1, requestedCloseMonth?: string | null): Promise<FinanceWorkday> {
  const closeMonth = requestedCloseMonth ?? previousCompletedKoreaMonth();
  const [summary, pendingBookings, receiptResult, periodResult, postCloseResult] = await Promise.all([
    loadFinanceCenterSummary(taxRate),
    loadFinanceBookingReviews({ status: 'pending', sort: 'departure_asc' }),
    supabaseAdmin
      .from('bank_transaction_classifications')
      .select('id', { count: 'exact', head: true })
      .eq('receipt_status', 'missing'),
    supabaseAdmin
      .from('settlement_periods')
      .select('status')
      .eq('departure_month', `${closeMonth}-01`)
      .eq('is_current', true)
      .limit(1),
    supabaseAdmin
      .from('settlement_period_exceptions')
      .select('id')
      .eq('departure_month', `${closeMonth}-01`)
      .eq('exception_type', 'post_close_change')
      .eq('status', 'open')
      .limit(500),
  ]);
  if (receiptResult.error) throw receiptResult.error;
  if (periodResult.error) throw periodResult.error;
  if (postCloseResult.error) throw postCloseResult.error;
  const periodStatus = periodResult.data?.[0]?.status;
  const globalTravelTransactionIds = summary.actionRefs?.travelTransactionIds ?? [];
  const travelScopeRows: FinanceTravelActionScopeRow[] = [];

  if (globalTravelTransactionIds.length > 0) {
    const idChunks = chunks(globalTravelTransactionIds);
    const [transactionResults, allocationResults] = await Promise.all([
      Promise.all(idChunks.map(ids => supabaseAdmin
        .from('bank_transactions')
        .select('id, received_at, memo')
        .in('id', ids))),
      Promise.all(idChunks.map(ids => supabaseAdmin
        .from('bank_transaction_allocations')
        .select('bank_transaction_id, booking_id')
        .in('bank_transaction_id', ids)
        .eq('status', 'active')
        .is('reversed_at', null)
        .not('booking_id', 'is', null))),
    ]);
    const transactionError = transactionResults.find(result => result.error)?.error;
    const allocationError = allocationResults.find(result => result.error)?.error;
    if (transactionError) throw transactionError;
    if (allocationError) throw allocationError;
    const transactionRows = transactionResults.flatMap(result => result.data ?? []);
    const allocationRows = allocationResults.flatMap(result => result.data ?? []);

    const bookingIds = [...new Set(allocationRows
      .flatMap(row => row.booking_id ? [String(row.booking_id)] : []))];
    const bookingResult = bookingIds.length > 0
      ? await supabaseAdmin.from('bookings').select('id, departure_date').in('id', bookingIds)
      : { data: [], error: null };
    if (bookingResult.error) throw bookingResult.error;

    const departureByBooking = new Map((bookingResult.data ?? [])
      .map(row => [String(row.id), String(row.departure_date ?? '')]));
    const bookingDatesByTransaction = new Map<string, string[]>();
    for (const allocation of allocationRows) {
      if (!allocation.booking_id) continue;
      const departureDate = departureByBooking.get(String(allocation.booking_id));
      if (!departureDate) continue;
      const transactionId = String(allocation.bank_transaction_id);
      const dates = bookingDatesByTransaction.get(transactionId) ?? [];
      dates.push(departureDate);
      bookingDatesByTransaction.set(transactionId, dates);
    }

    travelScopeRows.push(...transactionRows.map(row => ({
      id: String(row.id),
      receivedAt: String(row.received_at),
      memo: row.memo ? String(row.memo) : null,
      bookingDepartureDates: bookingDatesByTransaction.get(String(row.id)) ?? [],
    })));
  }

  const closeMonthTravelTransactionIds = scopeTravelActionTransactionIds(travelScopeRows, closeMonth);

  return buildFinanceWorkday({
    summary,
    pendingBookings: pendingBookings.rows,
    missingReceiptCount: receiptResult.count ?? 0,
    closeMonth,
    closeMonthClosed: periodStatus === 'closed' || periodStatus === 'conditional',
    closeMonthPostCloseExceptionIds: (postCloseResult.data ?? []).map(row => String(row.id)),
    closeMonthTravelTransactionIds,
    otherMonthTravelReviewCount: Math.max(0, globalTravelTransactionIds.length - closeMonthTravelTransactionIds.length),
  });
}
