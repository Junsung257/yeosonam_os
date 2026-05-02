import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import AffiliatesPageClient from './AffiliatesPageClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';
export const revalidate = 60;

function AffiliatesSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 bg-slate-100 rounded w-40" />
          <div className="h-3 bg-slate-100 rounded w-56" />
        </div>
        <div className="h-9 bg-slate-100 rounded w-28" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <div className="h-3 bg-slate-100 rounded w-24" />
            <div className="h-6 bg-slate-100 rounded w-20" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-slate-100 px-3 py-3 flex gap-4">
            <div className="h-4 bg-slate-100 rounded w-24" />
            <div className="h-4 bg-slate-100 rounded w-20" />
            <div className="h-4 bg-slate-100 rounded flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function AffiliatesDataFetcher() {
  const affiliates = isSupabaseConfigured
    ? await supabaseAdmin
        .from('affiliates')
        .select(
          'id, name, phone, email, referral_code, grade, grade_label, bonus_rate, payout_type, booking_count, total_commission, memo'
        )
        .order('created_at', { ascending: false })
        .limit(100)
        .then((r: { data: unknown[] | null }) => r.data ?? [])
    : [];

  return <AffiliatesPageClient initialAffiliates={affiliates as any} />;
}

export default function AffiliatesPage() {
  return (
    <Suspense fallback={<AffiliatesSkeleton />}>
      <AffiliatesDataFetcher />
    </Suspense>
  );
}
