import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import FreeTravelPageClient from './FreeTravelPageClient';

// Windows dev: chunk race 방지 / Vercel(Linux): 30초 캐시
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';
export const revalidate = 30;

function FreeTravelSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 bg-slate-100 rounded w-52" />
        <div className="h-4 bg-slate-100 rounded w-72" />
      </div>
      <div className="flex border-b border-gray-200 mb-6 gap-1">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-slate-100 rounded-t w-28 mx-0.5" />
        ))}
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 mb-3 space-y-2">
          <div className="h-4 bg-slate-100 rounded w-3/4" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
          <div className="h-3 bg-slate-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

async function FreeTravelDataFetcher() {
  const sessions = isSupabaseConfigured
    ? await supabaseAdmin
        .from('free_travel_sessions')
        .select(
          'id, destination, departure, date_from, date_to, pax_adults, pax_children, customer_phone, customer_name, plan_json, source, status, mrt_booking_ref, booked_by, booked_at, admin_notes, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(50)
        .then((r: { data: unknown[] | null }) => r.data ?? [])
    : [];

  return <FreeTravelPageClient initialSessions={sessions as any} />;
}

export default function FreeTravelAdminPage() {
  return (
    <Suspense fallback={<FreeTravelSkeleton />}>
      <FreeTravelDataFetcher />
    </Suspense>
  );
}
