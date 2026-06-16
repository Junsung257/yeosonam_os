import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import AffiliatesPageClient from './AffiliatesPageClient';

export const dynamic = 'force-dynamic';

function AffiliatesSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 bg-admin-surface-2 rounded w-40" />
          <div className="h-3 bg-admin-surface-2 rounded w-56" />
        </div>
        <div className="h-9 bg-admin-surface-2 rounded w-28" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 space-y-2">
            <div className="h-3 bg-admin-surface-2 rounded w-24" />
            <div className="h-6 bg-admin-surface-2 rounded w-20" />
          </div>
        ))}
      </div>
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-admin-border px-3 py-3 flex gap-4">
            <div className="h-4 bg-admin-surface-2 rounded w-24" />
            <div className="h-4 bg-admin-surface-2 rounded w-20" />
            <div className="h-4 bg-admin-surface-2 rounded flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function AffiliatesDataFetcher() {
  const affiliates = isSupabaseAdminConfigured
    ? await supabaseAdmin
        .from('affiliates')
        .select(
          'id, name, phone, email, referral_code, grade, grade_label, bonus_rate, payout_type, booking_count, total_commission, memo'
        )
        .order('created_at', { ascending: false })
        .limit(100)
        .then((r: { data: unknown[] | null }) => r.data ?? [])
    : [];

  return <AffiliatesPageClient initialAffiliates={affiliates as unknown as { id: string; name: string; phone?: string; email?: string; referral_code: string; grade: number; grade_label: string; bonus_rate: number; payout_type: 'PERSONAL' | 'BUSINESS'; booking_count: number; total_commission: number; memo?: string; }[]} />;
}

export default function AffiliatesPage() {
  return (
    <Suspense fallback={<AffiliatesSkeleton />}>
      <AffiliatesDataFetcher />
    </Suspense>
  );
}
