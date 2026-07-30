'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Users, Receipt, Wallet } from 'lucide-react';

interface ChannelCohort {
  channel: string;
  customerCount: number;
  totalRevenue: number;
  avgLtv: number;
  avgBookingsPerCustomer: number;
  totalBookings: number;
}

interface CohortResponse {
  cohorts?: ChannelCohort[];
  totalCustomers?: number;
  totalBookings?: number;
  basis?: 'all_eligible_bookings';
  error?: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  direct: '직접 유입', kakao: '카카오', naver: '네이버', instagram: '인스타그램',
  facebook: '페이스북', google: '구글', blog: '블로그', referral: '소개', organic: '자연 검색',
};

function money(value: number): string {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value);
}

export default function AnalyticsDashboard() {
  const [cohorts, setCohorts] = useState<ChannelCohort[]>([]);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/analytics/ltv', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as CohortResponse;
      if (!response.ok) throw new Error(payload.error || '유입 성과 조회 실패');
      setCohorts(payload.cohorts ?? []);
      setTotalCustomers(payload.totalCustomers ?? 0);
    } catch (loadError) {
      setCohorts([]);
      setError(loadError instanceof Error ? loadError.message : '유입 성과 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => cohorts.reduce((sum, cohort) => ({
    revenue: sum.revenue + cohort.totalRevenue,
    bookings: sum.bookings + cohort.totalBookings,
  }), { revenue: 0, bookings: 0 }), [cohorts]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="유입 성과 불러오는 중">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="admin-card h-28 animate-pulse bg-admin-surface-2" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-card border-red-200 bg-red-50 p-5 text-sm text-red-700" role="alert">
        <p className="font-semibold">실제 유입 성과를 조회하지 못했습니다.</p>
        <p className="mt-1">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1 rounded-admin-sm border border-red-300 px-3 py-1.5 font-medium">
          <RefreshCw size={14} /> 다시 조회
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-admin-lg font-bold text-admin-text">실제 유입·고객 가치</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">완료 단계 예약의 최초 UTM 채널과 실제 입금액 기준</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-admin-sm border border-admin-border-mid bg-white px-3 py-1.5 text-admin-xs font-medium text-admin-text-2 hover:bg-admin-bg">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric icon={<Users size={18} />} label="귀속 고객" value={`${totalCustomers.toLocaleString()}명`} />
        <Metric icon={<Receipt size={18} />} label="완료 단계 예약" value={`${totals.bookings.toLocaleString()}건`} />
        <Metric icon={<Wallet size={18} />} label="귀속 입금액" value={money(totals.revenue)} />
      </div>

      {cohorts.length === 0 ? (
        <div className="admin-card p-10 text-center">
          <p className="font-medium text-admin-text">귀속 가능한 완료 예약이 없습니다.</p>
          <p className="mt-1 text-admin-sm text-admin-muted">예약 생성 시 UTM 채널을 저장하면 이 화면에 실제 성과가 집계됩니다.</p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-admin-sm">
              <thead className="bg-admin-bg text-admin-xs text-admin-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">최초 유입 채널</th>
                  <th className="px-4 py-3 text-right font-semibold">고객</th>
                  <th className="px-4 py-3 text-right font-semibold">예약</th>
                  <th className="px-4 py-3 text-right font-semibold">고객당 예약</th>
                  <th className="px-4 py-3 text-right font-semibold">평균 LTV</th>
                  <th className="px-4 py-3 text-right font-semibold">누적 입금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {cohorts.map(cohort => (
                  <tr key={cohort.channel} className="hover:bg-admin-bg">
                    <td className="px-4 py-3 font-semibold text-admin-text">{CHANNEL_LABEL[cohort.channel] ?? cohort.channel}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cohort.customerCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cohort.totalBookings.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cohort.avgBookingsPerCustomer.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(cohort.avgLtv)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-admin-text">{money(cohort.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="admin-card flex items-center gap-3 p-4">
      <span className="rounded-admin-sm bg-brand-light p-2 text-brand">{icon}</span>
      <div>
        <p className="text-admin-xs font-medium text-admin-muted">{label}</p>
        <p className="mt-0.5 text-admin-h2 font-bold tabular-nums text-admin-text">{value}</p>
      </div>
    </div>
  );
}
