import { supabaseAdmin, isSupabaseAdminConfigured, getMessageLogs } from '@/lib/supabase';
import BookingDetailClient, { type BookingDetail } from './BookingDetailClient';

export const dynamic = 'force-dynamic';

export default async function BookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseAdminConfigured) {
    return <BookingDetailClient params={params} />;
  }

  const [bookingResult, logs, clobeKeyResult] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone,passport_expiry), booking_passengers(passenger_type, customers(id,name,phone,passport_expiry,passport_no))')
      .eq('id', id)
      .limit(1),
    getMessageLogs(id),
    supabaseAdmin
      .from('booking_settlement_keys')
      .select('id')
      .eq('booking_id', id)
      .eq('status', 'active')
      .or('source.eq.clobe_memo_created_booking,source.eq.bank_memo_created_booking,source.eq.clobe_memo_approved_booking')
      .limit(1)
      .maybeSingle(),
  ]);

  const raw = bookingResult.data?.[0] ?? null;
  let initialBooking: import('./BookingDetailClient').BookingDetail | null = null;
  if (raw) {
    interface BookingPassenger { customers?: Record<string, unknown> | null; passenger_type?: string | null; }
    interface BookingWithPassengers extends Record<string, unknown> { booking_passengers?: BookingPassenger[]; }
    const rawBooking = raw as BookingWithPassengers;
    const passengers = (rawBooking.booking_passengers ?? [])
      .map(bp => bp.customers ? { ...bp.customers, passenger_type: bp.passenger_type || 'adult' } : null)
      .filter(Boolean) as unknown as import('./BookingDetailClient').BookingDetail['passengers'];
    initialBooking = {
      ...rawBooking,
      passengers,
      clobe_settlement_booking: Boolean(clobeKeyResult.data),
    } as unknown as import('./BookingDetailClient').BookingDetail;
  }

  return (
    <BookingDetailClient
      params={params}
      initialBooking={initialBooking as unknown as BookingDetail}
      initialLogs={logs}
    />
  );
}
