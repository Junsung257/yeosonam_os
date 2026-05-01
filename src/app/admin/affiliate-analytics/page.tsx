'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/AdminLayout';
import KPIBasisToggle from '@/components/admin/KPIBasisToggle';
import { DEFAULT_KPI_BASIS, getBasisMeta, type KPIBasis } from '@/lib/kpi-basis';

interface KPI {
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  totalRevenue: number;
  totalCommission: number;
  partnerCount: number;
  activeCount: number;
}

interface Partner {
  id: string;
  name: string;
  referral_code: string;
  grade: number;
  is_active: boolean;
  commission_rate: number;
  clicks: number;
  conversions: number;
  conversion_rate: number;
  revenue: number;
  commission: number;
  booking_count: number;
  avg_commission: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  commission: number;
  count: number;
}

const GRADE_LABELS = ['', '브론즈', '실버', '골드', '플래티넘', '다이아'];
const GRADE_COLORS = ['', 'text-gray-500', 'text-slate-600', 'text-yellow-600', 'text-purple-600', 'text-blue-600'];

export default function AffiliateAnalyticsPage() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  // KPI 산식 기준 토글 — 예약(생성일, 수수료 정산) ↔ 매출 인식(출발일, IFRS 15)
  // 어필리에이트 정산 정책은 commission(생성일) 기준이 default. 회계용 비교는 accounting.
  const [basis, setBasis] = useState<KPIBasis>(DEFAULT_KPI_BASIS);
  const [refetching, setRefetching] = useState(false);
  const basisMeta = getBasisMeta(basis);

  useEffect(() => {
    // 초기 로드는 loading, basis 변경은 refetching (토글 유지)
    const isInitial = kpi === null;
    if (isInitial) setLoading(true); else setRefetching(true);
    fetch(`/api/admin/affiliate-analytics?basis=${basis}`)
      .then(r => r.json())
      .then(data => {
        setKpi(data.kpi || null);
        setPartners(data.partners || []);
        setMonthly(data.monthly || []);
      })
      .finally(() => { setLoading(false); setRefetching(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20 text-gray-400">불러오는 중...</div>
      </AdminLayout>
    );
  }

  const maxRevenue = Math.max(...monthly.map(m => m.revenue), 1);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">어필리에이트 퍼널 분석</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">{basisMeta.description}</p>
          </div>
          <div className="flex items-center gap-2">
            {refetching && <span className="text-[11px] text-gray-400">갱신 중…</span>}
            <KPIBasisToggle value={basis} onChange={setBasis} />
          </div>
        </div>

        {/* KPI 카드 — basis 표기로 정의 명확화 */}
        {kpi && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="총 클릭수" value={kpi.totalClicks.toLocaleString()} sub={`${kpi.activeCount}/${kpi.partnerCount} 파트너 활성`} />
            <KpiCard label="총 전환수" value={kpi.totalConversions.toLocaleString()} sub={`전환율 ${kpi.conversionRate}%`} color="text-green-600" />
            <KpiCard
              label={`기여 매출 · ${basisMeta.shortLabel} 기준`}
              value={`₩${(kpi.totalRevenue / 10000).toFixed(0)}만`}
              sub={basisMeta.dateField === 'departure_date' ? '출발 완료 비취소' : '예약 생성일 기준'}
              color="text-blue-600"
            />
            <KpiCard
              label={`커미션 · ${basisMeta.shortLabel} 기준`}
              value={`₩${(kpi.totalCommission / 10000).toFixed(0)}만`}
              sub="지급 총액"
              color="text-purple-600"
            />
          </div>
        )}

        {/* 월별 추세 */}
        {monthly.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">월별 어필리에이트 매출 추세</h2>
            <div className="flex items-end gap-3 h-40">
              {monthly.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-500">{(m.revenue / 10000).toFixed(0)}만</span>
                  <div className="w-full bg-blue-100 rounded-t-lg relative" style={{ height: `${Math.max((m.revenue / maxRevenue) * 100, 4)}%` }}>
                    <div className="absolute inset-0 bg-blue-500 rounded-t-lg" style={{ height: `${m.commission > 0 ? Math.min((m.commission / m.revenue) * 100, 100) : 0}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400">{m.month.slice(5)}월</span>
                  <span className="text-[10px] text-gray-500">{m.count}건</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded" />매출</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded" />커미션</span>
            </div>
          </div>
        )}

        {/* 파트너별 성과 테이블 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">파트너별 성과</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">파트너</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-600">등급</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">클릭</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">전환</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">전환율</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">기여매출</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">커미션</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">평균단가</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <a href={`/admin/affiliates/${p.id}`} className="text-blue-600 hover:underline font-medium">{p.name}</a>
                      {!p.is_active && <span className="ml-1 text-[10px] text-red-400">비활성</span>}
                    </td>
                    <td className={`px-3 py-2.5 font-medium ${GRADE_COLORS[p.grade] || ''}`}>
                      {GRADE_LABELS[p.grade] || '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{p.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{p.conversions.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={p.conversion_rate >= 5 ? 'text-green-600 font-medium' : p.conversion_rate >= 2 ? 'text-gray-700' : 'text-red-500'}>
                        {p.conversion_rate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">₩{(p.revenue / 10000).toFixed(0)}만</td>
                    <td className="px-3 py-2.5 text-right font-medium text-purple-600">₩{p.commission.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">₩{p.avg_commission.toLocaleString()}</td>
                  </tr>
                ))}
                {partners.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
