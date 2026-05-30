import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import FreeTravelPageClient from './FreeTravelPageClient';

// Next 15: 정적 평가만 가능. 항상 'auto' + 30초 캐시.
export const dynamic = 'auto';
export const revalidate = 30;

function FreeTravelSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 bg-admin-surface-2 rounded w-52" />
        <div className="h-4 bg-admin-surface-2 rounded w-72" />
      </div>
      <div className="flex border-b border-admin-border-mid mb-6 gap-1">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-admin-surface-2 rounded-t w-28 mx-0.5" />
        ))}
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 mb-3 space-y-2">
          <div className="h-4 bg-admin-surface-2 rounded w-3/4" />
          <div className="h-3 bg-admin-surface-2 rounded w-1/2" />
          <div className="h-3 bg-admin-surface-2 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

async function computeItineraryMetrics(windowDays: number) {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('free_travel_sessions')
    .select('plan_json')
    .gte('created_at', since)
    .limit(3000);
  if (error) return null;
  const rows = data ?? [];
  let llm = 0;
  let template = 0;
  let unknown = 0;
  const errCounts: Record<string, number> = {};
  for (const row of rows) {
    const pj = row.plan_json as Record<string, unknown> | null;
    const src = pj?.itinerarySource;
    if (src === 'llm') llm += 1;
    else if (src === 'template') template += 1;
    else unknown += 1;
    const er = pj?.itineraryLlmError;
    if (typeof er === 'string' && er) errCounts[er] = (errCounts[er] ?? 0) + 1;
  }
  return {
    windowDays,
    sampleSize: rows.length,
    llm,
    template,
    unknown,
    itineraryLlmErrorCounts: errCounts,
  };
}

async function FreeTravelDataFetcher() {
  const [sessions, m7, m30, m90] = await Promise.all([
    isSupabaseConfigured
      ? supabaseAdmin
          .from('free_travel_sessions')
          .select(
            'id, destination, departure, date_from, date_to, pax_adults, pax_children, customer_phone, customer_name, plan_json, source, status, mrt_booking_ref, booked_by, booked_at, admin_notes, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(50)
          .then((r: { data: unknown[] | null }) => r.data ?? [])
      : Promise.resolve([]),
    computeItineraryMetrics(7),
    computeItineraryMetrics(30),
    computeItineraryMetrics(90),
  ]);

  return (
    <FreeTravelPageClient
      initialSessions={sessions as unknown as Array<{ id: string; destination: string; departure: string; date_from: string; date_to: string; pax_adults: number; pax_children: number; customer_phone: string | null; customer_name: string | null; plan_json: { hotels: { name: string; pricePerNight: number }[]; flights: { airline: string; price: number }[]; activities: { name: string; price: number }[]; aiSummary: string; comparison: { totalMin: number; totalMax: number }; itinerarySource?: 'llm' | 'template'; itineraryLlmError?: string; itineraryScore?: { score: number; label: string }; plannerPreferences?: { companionType?: string | null; hotelBudgetBand?: string | null; travelPace?: string | null; }; }; source: string; status?: string; mrt_booking_ref?: string | null; booked_by?: string | null; booked_at?: string | null; admin_notes?: string | null; created_at: string; }>}
      itineraryMetricsByWindow={{ 7: m7, 30: m30, 90: m90 }}
    />
  );
}

export default function FreeTravelAdminPage() {
  return (
    <Suspense fallback={<FreeTravelSkeleton />}>
      <FreeTravelDataFetcher />
    </Suspense>
  );
}
