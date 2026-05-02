import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { Suspense } from 'react';
import PaymentsPageClient from './PaymentsPageClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function PaymentsPage() {
  if (!isSupabaseConfigured) {
    return <Suspense><PaymentsPageClient /></Suspense>;
  }

  const txSelect = `
    *,
    bookings!booking_id(
      id, booking_no, package_title,
      total_price, paid_amount, total_paid_out, departure_date,
      customers!lead_customer_id(name)
    )
  `;

  const [txResult, excludedResult, unmatchedResult, erpResult, bookingsResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select(txSelect)
      .neq('status', 'excluded')
      .order('received_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('bank_transactions')
      .select(txSelect)
      .eq('status', 'excluded')
      .order('received_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('bank_transactions')
      .select(txSelect)
      .in('match_status', ['unmatched'])
      .neq('status', 'excluded')
      .order('received_at', { ascending: false }),
    supabaseAdmin
      .from('bookings')
      .select('status, total_price, total_cost, paid_amount')
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, total_price, total_cost, paid_amount, total_paid_out, departure_date, status, lead_customer_id, customers!lead_customer_id(name)')
      .in('status', ['pending', 'confirmed']),
  ]);

  // Merge active + unmatched (unmatched extends beyond 500 limit)
  const mainTxs = (txResult.data ?? []) as any[];
  const unmatchedTxs = (unmatchedResult.data ?? []) as any[];
  const mainIds = new Set(mainTxs.map(t => t.id));
  const mergedTxs = [...mainTxs, ...unmatchedTxs.filter(u => !mainIds.has(u.id))];

  // Compute ERP stats server-side
  const erpRows = (erpResult.data ?? []) as any[];
  const totalPrice = erpRows.reduce((s, b) => s + (b.total_price || 0), 0);
  const totalCost  = erpRows.reduce((s, b) => s + (b.total_cost  || 0), 0);
  const totalPaid  = erpRows.reduce((s, b) => s + (b.paid_amount || 0), 0);
  const initialErp = {
    totalPrice, totalCost, totalPaid,
    remaining: totalPrice - totalPaid,
    margin: totalPrice - totalCost,
    bookingCount: erpRows.length,
  };

  return (
    <Suspense>
      <PaymentsPageClient
        initialTransactions={mergedTxs as any}
        initialTrashTxs={(excludedResult.data ?? []) as any}
        initialBookings={(bookingsResult.data ?? []) as any}
        initialErp={initialErp}
      />
    </Suspense>
  );
}
