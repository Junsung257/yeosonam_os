import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { Suspense } from 'react';
import PaymentsPageClient from './PaymentsPageClient';
import type { BankTransaction, BookingFull } from './PaymentsPageClient';
import { calculatePaymentKpis } from '@/lib/payment-kpi';
import { matchesPaymentPeriod } from '@/lib/payment-period-filter';

export const dynamic = 'force-dynamic';

function PaymentsPageFallback() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="h-7 w-28 rounded bg-admin-surface-2" />
          <div className="mt-2 h-4 w-72 rounded bg-admin-surface-2" />
        </div>
        <div className="h-9 w-24 rounded bg-admin-surface-2" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {[...Array(4)].map((_, index) => (
          <div key={index} className="h-24 rounded-admin-md border border-admin-border bg-admin-surface" />
        ))}
      </div>
      <div className="h-96 rounded-admin-md border border-admin-border bg-admin-surface" />
    </div>
  );
}

export default async function PaymentsPage() {
  if (!isSupabaseAdminConfigured) {
    return (
      <Suspense fallback={<PaymentsPageFallback />}>
        <PaymentsPageClient />
      </Suspense>
    );
  }

  const txSelect = `
    *,
    bookings!booking_id(
      id, booking_no, package_title,
      total_price, total_cost, paid_amount, total_paid_out, departure_date,
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
      .select('status, departure_date, total_price, total_cost, paid_amount, total_paid_out')
      .neq('status', 'cancelled')
      .eq('is_deleted', false),
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, total_price, total_cost, paid_amount, total_paid_out, departure_date, status, lead_customer_id, customers!lead_customer_id(name)')
      .in('status', ['pending', 'confirmed']),
  ]);

  // Merge active + unmatched (unmatched extends beyond 500 limit)
  const mainTxs = txResult.data ?? [];
  const unmatchedTxs = unmatchedResult.data ?? [];
  const mainIds = new Set(mainTxs.map((t: { id: string }) => t.id));
  const mergedTxs = [...mainTxs, ...unmatchedTxs.filter((u: { id: string }) => !mainIds.has(u.id))];

  // Compute ERP stats server-side
  const erpRows = (erpResult.data ?? []).filter(row =>
    matchesPaymentPeriod(row.departure_date, '이번 달'),
  );
  const initialErp = calculatePaymentKpis(erpRows);

  return (
    <Suspense fallback={<PaymentsPageFallback />}>
      <PaymentsPageClient
        initialTransactions={mergedTxs as unknown as BankTransaction[]}
        initialTrashTxs={(excludedResult.data ?? []) as unknown as BankTransaction[]}
        initialBookings={(bookingsResult.data ?? []) as unknown as BookingFull[]}
        initialErp={initialErp}
      />
    </Suspense>
  );
}
