/**
 * 마일리지 분석 대시보드 (Admin)
 *
 * /admin/mileage-analytics
 *
 * - 월별 적립/사용/소멸 추이
 * - 등급별 마일리지 분포
 * - 미사용 마일리지 총액 (부채)
 * - 마일리지가 매출에 미친 영향
 */
'use client';

import { useEffect, useState } from 'react';

interface MonthlyData {
  month: string;
  earned: number;
  used: number;
  expired: number;
}

interface GradeDistribution {
  grade: string;
  count: number;
  avgMileage: number;
  totalMileage: number;
}

interface Stats {
  totalBalance: number;
  customerCount: number;
  avgMileage: number;
  monthlyData: MonthlyData[];
  gradeDistribution: GradeDistribution[];
  mileageUsageRate: number;
  totalEarnedAllTime: number;
  totalExpiredAllTime: number;
}

export default function MileageAnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/mileage/analytics');
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setStats(data);
      } catch (e: any) {
        console.error('[MileageAnalytics] 로드 실패:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  // ── 도우미 ──
  const formatAmount = (v: number) => v.toLocaleString() + 'P';
  const maxEarned = stats?.monthlyData?.length
    ? Math.max(...stats.monthlyData.map((m) => m.earned), 1)
    : 1;

  return (
    <>
      <div className="p-6 space-y-8">
        <h1 className="text-xl font-bold text-gray-800 mb-6">마일리지 분석</h1>
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-admin-accent" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && stats && (
          <>
            {/* 상단 요약 카드 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="미사용 마일리지 총액 (부채)"
                value={formatAmount(stats.totalBalance)}
                sub={`${stats.customerCount.toLocaleString()}명 보유`}
                color="blue"
              />
              <SummaryCard
                label="1인 평균 마일리지"
                value={formatAmount(stats.avgMileage)}
                sub="전체 고객 기준"
                color="emerald"
              />
              <SummaryCard
                label="마일리지 사용률"
                value={`${stats.mileageUsageRate.toFixed(1)}%`}
                sub={`누적 적립 ${formatAmount(stats.totalEarnedAllTime)}`}
                color="amber"
              />
              <SummaryCard
                label="누적 소멸"
                value={formatAmount(stats.totalExpiredAllTime)}
                sub="전체 기간"
                color="red"
              />
            </div>

            {/* 월별 추이 (막대 차트) */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">월별 적립 / 사용 / 소멸 추이</h3>
              <div className="space-y-1.5">
                {stats.monthlyData.map((m) => (
                  <div key={m.month} className="space-y-0.5">
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>{m.month}</span>
                      <span>
                        적립 {formatAmount(m.earned)} / 사용 {formatAmount(m.used)} / 소멸{' '}
                        {formatAmount(m.expired)}
                      </span>
                    </div>
                    <div className="flex h-4 gap-0.5 rounded overflow-hidden bg-gray-50">
                      <div
                        className="bg-blue-400 transition-all"
                        style={{ width: `${(m.earned / maxEarned) * 100}%` }}
                        title={`적립 ${m.earned.toLocaleString()}`}
                      />
                      <div
                        className="bg-amber-400 transition-all"
                        style={{ width: `${(m.used / maxEarned) * 100}%` }}
                        title={`사용 ${m.used.toLocaleString()}`}
                      />
                      <div
                        className="bg-red-300 transition-all"
                        style={{ width: `${(m.expired / maxEarned) * 100}%` }}
                        title={`소멸 ${m.expired.toLocaleString()}`}
                      />
                    </div>
                  </div>
                ))}
                {stats.monthlyData.length === 0 && (
                  <p className="text-gray-400 text-xs py-4 text-center">데이터 없음</p>
                )}
              </div>
            </div>

            {/* 등급별 분포 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">등급별 마일리지 분포</h3>
                <div className="space-y-3">
                  {stats.gradeDistribution.map((g) => (
                    <div key={g.grade}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="font-medium">{g.grade}</span>
                        <span>
                          {g.count.toLocaleString()}명 / 평균 {formatAmount(g.avgMileage)}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 rounded transition-all"
                          style={{
                            width: `${(g.totalMileage / (stats.totalBalance || 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {stats.gradeDistribution.length === 0 && (
                    <p className="text-gray-400 text-xs py-4 text-center">데이터 없음</p>
                  )}
                </div>
              </div>

              {/* 영향도 분석 */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">마일리지 영향도</h3>
                <div className="space-y-4">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-blue-700 mb-1">마일리지 사용 매출 비중</p>
                    <p className="text-2xl font-bold text-blue-800">
                      {stats.mileageUsageRate.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-blue-500 mt-1">
                      전체 결제 중 마일리지가 사용된 비율
                    </p>
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>
                      누적 적립 총액: <span className="font-medium">{formatAmount(stats.totalEarnedAllTime)}</span>
                    </p>
                    <p>
                      현재 부채(미사용):{' '}
                      <span className="font-medium">{formatAmount(stats.totalBalance)}</span>
                    </p>
                    <p>
                      사용률: {stats.totalEarnedAllTime > 0
                        ? (
                            ((stats.totalEarnedAllTime - stats.totalBalance) / stats.totalEarnedAllTime) *
                            100
                          ).toFixed(1)
                        : '0'}
                      %
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: 'blue' | 'emerald' | 'amber' | 'red';
}) {
  const colorMap = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <p className="text-[10px] font-semibold opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>
    </div>
  );
}
