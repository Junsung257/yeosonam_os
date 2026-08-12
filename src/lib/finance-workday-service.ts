import { loadFinanceCenterSummary } from '@/lib/finance-center-service';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';
import { buildFinanceWorkday, type FinanceWorkday } from '@/lib/finance-workday';
import { previousCompletedKoreaMonth } from '@/lib/monthly-settlement-close';
import { supabaseAdmin } from '@/lib/supabase';

export async function loadFinanceWorkday(taxRate = 0.1): Promise<FinanceWorkday> {
  const [summary, pendingBookings, receiptResult] = await Promise.all([
    loadFinanceCenterSummary(taxRate),
    loadFinanceBookingReviews({ status: 'pending' }),
    supabaseAdmin
      .from('bank_transaction_classifications')
      .select('id', { count: 'exact', head: true })
      .eq('receipt_status', 'missing'),
  ]);
  if (receiptResult.error) throw receiptResult.error;

  return buildFinanceWorkday({
    summary,
    pendingBookings: pendingBookings.rows,
    missingReceiptCount: receiptResult.count ?? 0,
    closeMonth: previousCompletedKoreaMonth(),
  });
}
