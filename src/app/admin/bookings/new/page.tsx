import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getRateInfo } from '@/lib/exchange-rate';
import { NewBookingFormClient } from './NewBookingFormClient';

interface ServerPackage { id: string; title: string; destination?: string; price?: number; }
interface ServerCustomer { id: string; name: string; phone?: string; passport_expiry?: string; }

export const dynamic = 'auto'; // Next 15: 정적 평가만 가능

const GRADE_LABELS: Record<number, string> = { 1: '브론즈', 2: '실버', 3: '골드', 4: '플래티넘', 5: '다이아' };

function NewBookingFallback() {
  return (
    <div className="min-h-screen bg-admin-bg py-8">
      <div className="max-w-3xl mx-auto px-4 space-y-6 animate-pulse">
        <div className="h-4 w-28 rounded bg-admin-surface-2" />
        <div className="h-8 w-36 rounded bg-admin-surface-2" />
        {[...Array(5)].map((_, index) => (
          <div key={index} className="rounded-admin-md bg-white p-5 shadow-admin-xs">
            <div className="h-5 w-36 rounded bg-admin-surface-2 mb-4" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-10 rounded bg-admin-surface-2" />
              <div className="h-10 rounded bg-admin-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function NewBookingPage() {
  if (!isSupabaseConfigured) {
    return (
      <Suspense fallback={<NewBookingFallback />}>
        <NewBookingFormClient />
      </Suspense>
    );
  }

  const [pkgResult, custResult, affResult, rateInfo] = await Promise.all([
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price')
      .in('status', ['active', 'approved', 'pending'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('customers')
      .select('id, name, phone, passport_expiry')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, bonus_rate')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    getRateInfo().catch(() => ({ rate: 1400 })),
  ]);

  const affiliateRows = affResult.data ?? [];
  const affiliates = affiliateRows.map((a: { id: string; name: string; referral_code: string; grade: number; bonus_rate: number }) => ({
    ...a,
    grade_label: GRADE_LABELS[a.grade as number] || '브론즈',
  }));

  return (
    <Suspense fallback={<NewBookingFallback />}>
      <NewBookingFormClient
        initialPackages={(pkgResult.data ?? []) as unknown as ServerPackage[]}
        initialCustomers={(custResult.data ?? []) as unknown as ServerCustomer[]}
        initialAffiliates={affiliates as unknown as { id: string; name: string; referral_code: string; grade: number; grade_label: string; bonus_rate: number }[]}
        initialExchangeRate={rateInfo?.rate ?? 1400}
      />
    </Suspense>
  );
}
