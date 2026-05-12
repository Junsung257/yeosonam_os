import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import { getStatusLabel } from '@/lib/booking-state-machine';
import { resolveGuestPortalBookingId, touchGuestPortalToken } from '@/lib/booking-guest-token';
import GuestTripPortalClient from '@/components/booking/GuestTripPortalClient';

export const dynamic = 'force-dynamic';

export default async function GuestTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured || !token?.trim()) notFound();

  const resolved = await resolveGuestPortalBookingId(token.trim());
  if (!resolved) notFound();

  await touchGuestPortalToken(resolved.tokenRowId).catch(() => {});

  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .select(
      'booking_no, package_title, status, departure_date, total_price, paid_amount, deposit_amount, adult_count, child_count',
    )
    .eq('id', resolved.bookingId)
    .maybeSingle();

  if (error || !booking) notFound();

  const b = booking as {
    booking_no?: string;
    package_title?: string;
    status: string;
    departure_date?: string;
    total_price?: number;
    paid_amount?: number;
    deposit_amount?: number;
    adult_count?: number;
    child_count?: number;
  };

  return (
    <GuestTripPortalClient
      portalToken={token.trim()}
      snapshot={{
        booking_no: b.booking_no ?? null,
        package_title: b.package_title ?? null,
        status: b.status,
        status_label: getStatusLabel(b.status),
        departure_date: b.departure_date ?? null,
        total_price: b.total_price ?? 0,
        paid_amount: b.paid_amount ?? 0,
        deposit_amount: b.deposit_amount ?? 0,
        adult_count: b.adult_count ?? 0,
        child_count: b.child_count ?? 0,
      }}
    />
  );
}
