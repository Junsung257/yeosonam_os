import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import EditBookingClient from './EditBookingClient';

export const dynamic = 'force-dynamic';

export default async function EditBookingPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseAdminConfigured) {
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
      initialBooking={booking as unknown as { id: string; booking_no?: string; package_id?: string; package_title?: string; lead_customer_id: string; adult_count: number; child_count: number; adult_cost: number; adult_price: number; child_cost: number; child_price: number; fuel_surcharge: number; total_cost?: number; total_price?: number; status: string; departure_date?: string; notes?: string; created_at: string; customers?: { id: string; name: string; phone?: string; passport_expiry?: string; passport_no?: string }; booking_passengers?: { customers: { id: string; name: string; phone?: string; passport_expiry?: string; passport_no?: string } }[]; }}
      initialPackages={(packagesResult.data ?? []) as unknown as Array<{ id: string; title: string; destination?: string; price?: number; }>}
      initialCustomers={(customersResult.data ?? []) as unknown as Array<{ id: string; name: string; phone?: string; passport_expiry?: string; passport_no?: string; }>}
    />
  );
}
