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

interface SubStat {
  referral_code: string;
  sub_id: string;
  clicks_30d: number;
  unique_sessions_30d: number;
  touched_packages_30d: number;
}

type AttributionModel = 'last_touch' | 'first_touch' | 'linear';

interface ModelCompare {
  sample_size: number;
  first_touch_match_count: number;
  last_touch_match_count: number;
  linear_multi_touch_candidates: number;
  attribution_switch_count: number;
  affected_commission_pool_krw: number;
}

interface SubTrend {
  day: string;
  clicks: number;
  unique_sessions: number;
  touched_packages: number;
}

interface CronHealth {
  cron: string;
  success_count_7d: number;
  failure_count_7d: number;
  success_rate_7d: number;
  last_failure_at: string | null;
  last_failure_message: string | null;
}

const GRADE_LABELS = ['', '브론즈', '실버', '골드', '플래티넘', '다이아'];
const GRADE_COLORS = ['', 'text-gray-500', 'text-slate-600', 'text-yellow-600', 'text-purple-600', 'text-blue-600'];

export default function AffiliateAnalyticsPage() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [subStats, setSubStats] = useState<SubStat[]>([]);
  const [subTrend, setSubTrend] = useState<SubTrend[]>([]);
  const [modelCompare, setModelCompare] = useState<ModelCompare | null>(null);
  const [cronHealth, setCronHealth] = useState<CronHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [attributionModel, setAttributionModel] = useState<AttributionModel>('last_touch');
  const [savingModel, setSavingModel] = useState(false);

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
        setSubStats(data.sub_stats || []);
        setSubTrend(data.sub_trend || []);
        setModelCompare(data.model_compare || null);
        setCronHealth(data.cron_health || []);
      })
      .finally(() => { setLoading(false); setRefetching(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  useEffect(() => {
    fetch('/api/admin/affiliate-settings')
      .then((r) => r.json())
      .then((d) => {
        if (d?.attribution_model) setAttributionModel(d.attribution_model as AttributionModel);
      })
      .catch(() => {});
  }, []);

  const saveAttributionModel = async (model: AttributionModel) => {
    setSavingModel(true);
    try {
      const res = await fetch('/api/admin/affiliate-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribution_model: model }),
      });
      if (!res.ok) throw new Error();
      setAttributionModel(model);
    } catch {
      alert('모델 저장 실패');
    } finally {
      setSavingModel(false);
    }
  };

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

        {modelCompare && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">귀속 모델 비교 (최근 30일 샘플)</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 py-3">
                <p className="text-xs text-gray-500">샘플 예약</p>
                <p className="text-lg font-bold text-gray-900">{modelCompare.sample_size}</p>
              </div>
              <div className="rounded-lg bg-blue-50 py-3">
                <p className="text-xs text-blue-600">First-touch 일치</p>
                <p className="text-lg font-bold text-blue-700">{modelCompare.first_touch_match_count}</p>
              </div>
              <div className="rounded-lg bg-indigo-50 py-3">
                <p className="text-xs text-indigo-600">Last-touch 일치</p>
                <p className="text-lg font-bold text-indigo-700">{modelCompare.last_touch_match_count}</p>
              </div>
              <div className="rounded-lg bg-purple-50 py-3">
                <p className="text-xs text-purple-600">Linear 후보(다중터치)</p>
                <p className="text-lg font-bold text-purple-700">{modelCompare.linear_multi_touch_candidates}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-amber-50 py-3">
                <p className="text-xs text-amber-700">귀속 변경 가능 예약</p>
                <p className="text-lg font-bold text-amber-800">{modelCompare.attribution_switch_count}</p>
              </div>
              <div className="rounded-lg bg-rose-50 py-3">
                <p className="text-xs text-rose-700">영향 커미션 풀(예상)</p>
                <p className="text-lg font-bold text-rose-800">₩{modelCompare.affected_commission_pool_krw.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {cronHealth.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 text-sm">어필리에이트 크론 헬스 (최근 7일)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">크론</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">성공</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">실패</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">성공률</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">마지막 실패</th>
                  </tr>
                </thead>
                <tbody>
                  {cronHealth.map((c) => (
                    <tr key={c.cron} className="border-b border-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-700">{c.cron}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{c.success_count_7d.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-rose-700">{c.failure_count_7d.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${c.success_rate_7d >= 95 ? 'text-emerald-700' : c.success_rate_7d >= 80 ? 'text-amber-700' : 'text-rose-700'}`}>
                        {c.success_rate_7d.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {c.last_failure_at
                          ? `${new Date(c.last_failure_at).toLocaleString()} · ${c.last_failure_message || '실패'}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">멀티터치 귀속 모델</span>
          {(['last_touch', 'first_touch', 'linear'] as AttributionModel[]).map((m) => (
            <button
              key={m}
              disabled={savingModel}
              onClick={() => void saveAttributionModel(m)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                attributionModel === m
                  ? 'bg-[#001f3f] text-white border-[#001f3f]'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {m}
            </button>
          ))}
          <span className="text-[11px] text-gray-400 ml-auto">
            저장 시 다음 재계산 크론부터 적용
          </span>
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

        {subStats.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 text-sm">최근 30일 Sub-ID 상위 성과</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Referral</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Sub-ID</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">클릭</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">유니크 세션</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">터치 상품수</th>
                  </tr>
                </thead>
                <tbody>
                  {subStats.map((s, idx) => (
                    <tr key={`${s.referral_code}_${s.sub_id}_${idx}`} className="border-b border-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-700">{s.referral_code}</td>
                      <td className="px-3 py-2 text-gray-700">{s.sub_id}</td>
                      <td className="px-3 py-2 text-right">{s.clicks_30d.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{s.unique_sessions_30d.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{s.touched_packages_30d.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTrend.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Sub-ID 일별 트렌드 (최근 30일)</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {subTrend.slice(-12).map((d) => (
                <div key={d.day} className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[10px] text-gray-500">{d.day.slice(5)}</p>
                  <p className="text-sm font-bold text-gray-900">{d.clicks.toLocaleString()} 클릭</p>
                  <p className="text-[10px] text-gray-500">{d.unique_sessions.toLocaleString()} 유니크</p>
                </div>
              ))}
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
