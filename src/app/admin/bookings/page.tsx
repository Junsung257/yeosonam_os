import { Suspense } from 'react';
import { getBookings, isSupabaseAdminConfigured } from '@/lib/supabase';
import BookingsPageClient from './BookingsPageClient';

export const dynamic = 'force-dynamic';

type BookingListRow = {
  id: string;
  booking_no?: string;
  package_title?: string;
  product_id?: string;
  lead_customer_id: string;
  adult_count: number;
  child_count: number;
  adult_cost: number;
  adult_price: number;
  child_cost: number;
  child_price: number;
  fuel_surcharge: number;
  total_cost?: number;
  total_price?: number;
  paid_amount?: number;
  total_paid_out?: number;
  margin?: number;
  payment_status?: string;
  status: string;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  refund_settled_at?: string | null;
  net_cashflow?: number | null;
  settlement_confirmed_at?: string | null;
  settlement_confirmed_by?: string | null;
  settlement_mode?: 'accrual' | 'cash' | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
  departure_date?: string;
  departure_region?: string;
  booking_date?: string;
  land_operator?: string | null;
  land_operator_id?: string | null;
  departing_location_id?: string | null;
  manager_name?: string;
  payment_date?: string;
  notes?: string;
  is_deleted?: boolean;
  has_sent_docs?: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  customers?: { id: string; name: string; phone?: string };
};

function BookingsPageFallback() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="h-7 w-32 rounded bg-admin-surface-2" />
          <div className="mt-2 h-4 w-64 rounded bg-admin-surface-2" />
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

export default async function BookingsPage() {
  const initialBookings = isSupabaseAdminConfigured
    ? await getBookings(undefined, undefined, { lite: true })
    : [];

  return (
    <Suspense fallback={<BookingsPageFallback />}>
      <BookingsPageClient initialBookings={initialBookings as unknown as BookingListRow[]} />
    </Suspense>
  );
}
