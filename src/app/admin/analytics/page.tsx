'use client';

import { useState, useEffect } from 'react';

interface CohortRow {
  channel: string;
  customerCount: number;
  totalRevenue: number;
  avgLtv: number;
  avgBookingsPerCustomer: number;
  totalBookings: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  kakao:     '카카오',
  naver:     '네이버',
  instagram: '인스타그램',
  facebook:  '페이스북/메타',
  google:    '구글',
  blog:      '블로그',
  referral:  '지인 소개',
  organic:   '자연 검색',
  direct:    '직접 방문',
};
const CHANNEL_COLOR: Record<string, string> = {
  kakao:     'bg-yellow-400',
  naver:     'bg-green-500',
  instagram: 'bg-pink-400',
  facebook:  'bg-blue-500',
  google:    'bg-red-400',
  blog:      'bg-indigo-400',
  referral:  'bg-purple-400',
  organic:   'bg-teal-400',
  direct:    'bg-slate-400',
};

function fmt만(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`;
  return n.toLocaleString();
}

export default function AnalyticsPage() {
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/analytics/ltv')
      .then((r) => r.json())
      .then((d) => {
        setCohorts(d.cohorts ?? []);
        setTotal(d.totalCustomers ?? 0);
      })
      .catch(() => setFetchError('데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const maxRevenue = Math.max(...cohorts.map((c) => c.totalRevenue), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-admin-lg font-bold text-slate-800">LTV 코호트 분석</h1>
        <p className="text-admin-sm text-slate-500 mt-1">
          첫 예약 유입 채널별 고객 평생 결제액(LTV)을 비교합니다.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400 text-admin-base">분석 중...</div>
      ) : fetchError ? (
        <div className="text-center py-20 text-red-500 text-admin-base">{fetchError}</div>
      ) : cohorts.length === 0 ? (
        <div className="text-center py-20 text-slate-400 text-admin-base">
          UTM 데이터가 없습니다
        </div>
      ) : (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] text-slate-500 mb-1">총 고객 수</p>
              <p className="text-[22px] font-bold text-slate-800">{total.toLocaleString()}명</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] text-slate-500 mb-1">채널 수</p>
              <p className="text-[22px] font-bold text-slate-800">{cohorts.length}개</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] text-slate-500 mb-1">최고 LTV 채널</p>
              <p className="text-admin-lg font-bold text-slate-800">
                {CHANNEL_LABEL[cohorts[0]?.channel] ?? cohorts[0]?.channel}
              </p>
              <p className="text-admin-sm text-slate-500">평균 {fmt만(cohorts[0]?.avgLtv ?? 0)}원</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
              <p className="text-[11px] text-slate-500 mb-1">총 누적 매출</p>
              <p className="text-admin-lg font-bold text-slate-800">
                {fmt만(cohorts.reduce((s, c) => s + c.totalRevenue, 0))}원
              </p>
            </div>
          </div>

          {/* 막대 차트 */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-3">
            <h2 className="text-admin-base font-semibold text-slate-700">채널별 총 매출</h2>
            {cohorts.map((c) => {
              const pct = Math.max(4, (c.totalRevenue / maxRevenue) * 100);
              const colorClass = CHANNEL_COLOR[c.channel] ?? 'bg-slate-400';
              return (
                <div key={c.channel} className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-right text-admin-xs text-slate-600 font-medium">
                    {CHANNEL_LABEL[c.channel] ?? c.channel}
                  </div>
                  <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${colorClass} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-24 shrink-0 text-admin-xs text-slate-600">
                    {fmt만(c.totalRevenue)}원
                  </div>
                </div>
              );
            })}
          </div>

          {/* 상세 테이블 */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
            <table className="w-full text-admin-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['채널', '고객 수', '평균 LTV', '인당 예약', '총 매출'].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-admin-xs font-semibold text-slate-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c, i) => (
                  <tr
                    key={c.channel}
                    className={`border-b border-slate-100 ${i === 0 ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {CHANNEL_LABEL[c.channel] ?? c.channel}
                      {i === 0 && (
                        <span className="ml-2 text-[10px] bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded">
                          1위
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{c.customerCount.toLocaleString()}명</td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {fmt만(c.avgLtv)}원
                    </td>
                    <td className="py-3 px-4 text-slate-700">{c.avgBookingsPerCustomer}회</td>
                    <td className="py-3 px-4 text-slate-700">{fmt만(c.totalRevenue)}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
