import { loadFinanceCenterSummary } from '@/lib/finance-center-service';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';
import { buildFinanceWorkday, type FinanceWorkday } from '@/lib/finance-workday';
import { previousCompletedKoreaMonth } from '@/lib/monthly-settlement-close';
import { supabaseAdmin } from '@/lib/supabase';

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

  return buildFinanceWorkday({
    summary,
    pendingBookings: pendingBookings.rows,
    missingReceiptCount: receiptResult.count ?? 0,
    closeMonth,
    closeMonthClosed: periodStatus === 'closed' || periodStatus === 'conditional',
    closeMonthPostCloseExceptionIds: (postCloseResult.data ?? []).map(row => String(row.id)),
  });
}
