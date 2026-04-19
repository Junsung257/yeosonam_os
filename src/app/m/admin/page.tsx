import Link from 'next/link';
import { Plane, Wallet, AlertTriangle } from 'lucide-react';
import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { MobileStatCard } from '@/components/admin/mobile/MobileStatCard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchCounts() {
  if (!isSupabaseConfigured) {
    return { todayDeparture: 0, unmatched: 0, review: 0 };
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [todayBookings, unmatchedTx, reviewTx] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('departure_date', todayStr)
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('match_status', 'unmatched')
      .eq('transaction_type', '입금')
      .neq('status', 'excluded'),
    supabaseAdmin
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('match_status', 'review')
      .eq('transaction_type', '입금')
      .neq('status', 'excluded'),
  ]);

  return {
    todayDeparture: todayBookings.count ?? 0,
    unmatched: unmatchedTx.count ?? 0,
    review: reviewTx.count ?? 0,
  };
}

export default async function MobileAdminHome() {
  const counts = await fetchCounts();

  return (
    <>
      <MobileHeader
        title="여소남 관리"
        subtitle={new Date().toLocaleDateString('ko-KR', {
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        })}
      />
      <main className="px-4 py-4 space-y-4">
        <section>
          <h2 className="text-xs font-semibold text-slate-500 px-1 mb-2">
            오늘 처리할 것
          </h2>
          <div className="grid grid-cols-1 gap-3">
            <MobileStatCard
              label="오늘 출발"
              value={`${counts.todayDeparture}건`}
              hint="출발 당일 예약"
              icon={<Plane size={16} />}
              tone="slate"
              href={`/m/admin/bookings?departure=today`}
            />
            <div className="grid grid-cols-2 gap-3">
              <MobileStatCard
                label="검토 필요 매칭"
                value={`${counts.review}`}
                hint="금액/이름 애매"
                icon={<AlertTriangle size={16} />}
                tone="amber"
                href="/m/admin/payments?tab=review"
              />
              <MobileStatCard
                label="미확정 입금"
                value={`${counts.unmatched}`}
                hint="매칭 대기"
                icon={<Wallet size={16} />}
                tone="rose"
                href="/m/admin/payments?tab=unmatched"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-slate-500 px-1 mb-2">
            빠른 이동
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/m/admin/bookings"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-medium text-slate-900 active:bg-slate-50"
            >
              전체 예약 →
            </Link>
            <Link
              href="/m/admin/payments"
              className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-medium text-slate-900 active:bg-slate-50"
            >
              전체 입금 →
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
