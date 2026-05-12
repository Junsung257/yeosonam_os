import { supabaseAdmin, isSupabaseConfigured, getMessageLogs } from '@/lib/supabase';
import BookingDetailClient from './BookingDetailClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function BookingDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  if (!isSupabaseConfigured) {
    return <BookingDetailClient params={params} />;
  }

  const [bookingResult, logs] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone,passport_expiry), booking_passengers(passenger_type, customers(id,name,phone,passport_expiry,passport_no))')
      .eq('id', id)
      .limit(1),
    getMessageLogs(id),
  ]);

  const raw = bookingResult.data?.[0] ?? null;
  let initialBooking = null;
  if (raw) {
    const passengers = ((raw as any).booking_passengers ?? [])
      .map((bp: any) => bp.customers ? { ...bp.customers, passenger_type: bp.passenger_type || 'adult' } : null)
      .filter(Boolean);
    initialBooking = { ...(raw as any), passengers };
  }

  return (
    <BookingDetailClient
      params={params}
      initialBooking={initialBooking}
      initialLogs={logs}
    />
  );
}
