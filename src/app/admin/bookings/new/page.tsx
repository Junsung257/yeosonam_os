import { Suspense } from 'react';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getRateInfo } from '@/lib/exchange-rate';
import { NewBookingFormClient } from './NewBookingFormClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

const GRADE_LABELS: Record<number, string> = { 1: '브론즈', 2: '실버', 3: '골드', 4: '플래티넘', 5: '다이아' };

export default async function NewBookingPage() {
  if (!isSupabaseConfigured) {
    return <Suspense><NewBookingFormClient /></Suspense>;
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

  const affiliates = ((affResult.data ?? []) as any[]).map(a => ({
    ...a,
    grade_label: GRADE_LABELS[a.grade as number] || '브론즈',
  }));

  return (
    <Suspense>
      <NewBookingFormClient
        initialPackages={(pkgResult.data ?? []) as any}
        initialCustomers={(custResult.data ?? []) as any}
        initialAffiliates={affiliates as any}
        initialExchangeRate={(rateInfo as any).rate}
      />
    </Suspense>
  );
}
