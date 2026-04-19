import { notFound } from 'next/navigation';
import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import TimelineClient from './_client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface TimelineRow {
  id: string;
  event_type: string | null;
  title: string | null;
  content: string | null;
  log_type: string | null;
  created_at: string;
  created_by: string | null;
  is_mock: boolean | null;
}

async function fetchBookingMeta(bookingId: string) {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('booking_no, package_title, customers!lead_customer_id(name)')
    .eq('id', bookingId)
    .maybeSingle();
  return data;
}

async function fetchLogs(bookingId: string): Promise<TimelineRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('message_logs')
    .select('id, event_type, title, content, log_type, created_at, created_by, is_mock')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data as TimelineRow[] | null) ?? [];
}

export default async function TimelinePage({
  params,
}: {
  params: { bookingId: string };
}) {
  const [meta, logs] = await Promise.all([
    fetchBookingMeta(params.bookingId),
    fetchLogs(params.bookingId),
  ]);
  if (!meta) notFound();

  const metaAny = meta as any;

  return (
    <>
      <MobileHeader
        title="타임라인"
        subtitle={`${metaAny.booking_no ?? ''} · ${metaAny.customers?.name ?? ''}`}
        showBack
        backHref={`/m/admin/bookings/${params.bookingId}`}
      />
      <TimelineClient bookingId={params.bookingId} rows={logs} />
    </>
  );
}
