import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import EditBookingClient from './EditBookingClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function EditBookingPage({ params }: { params: { id: string } }) {
  const { id } = params;

  if (!isSupabaseConfigured) {
    return <EditBookingClient params={params} />;
  }

  const [bookingResult, packagesResult, customersResult] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select(`
        id, booking_no, package_id, package_title, lead_customer_id,
        adult_count, child_count, adult_cost, adult_price,
        child_cost, child_price, fuel_surcharge, total_cost, total_price,
        status, departure_date, notes, created_at,
        customers!lead_customer_id(id, name, phone, passport_expiry, passport_no),
        booking_passengers(customers(id, name, phone, passport_expiry, passport_no))
      `)
      .eq('id', id)
      .limit(1),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price')
      .in('status', ['active', 'approved', 'pending'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('customers')
      .select('id, name, phone, passport_expiry, passport_no')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const booking = bookingResult.data?.[0] ?? undefined;

  return (
    <EditBookingClient
      params={params}
      initialBooking={booking as any}
      initialPackages={(packagesResult.data ?? []) as any}
      initialCustomers={(customersResult.data ?? []) as any}
    />
  );
}
