'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getRoasGrade } from '@/lib/roas-calculator';
import type { AdCampaign, MonthlyAdStats } from '@/types/meta-ads';
import KPIBasisToggle from '@/components/admin/KPIBasisToggle';
import { getBasisMeta, type KPIBasis } from '@/lib/kpi-basis';
import MetricsCard from '@/components/admin/MetricsCard';
import PerformanceTrend, { type TrendPoint } from '@/components/admin/PerformanceTrend';

const LineChart = dynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const Legend = dynamic(() => import('recharts').then(m => ({ default: m.Legend })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });

const CampaignLinkBuilder = dynamic(() => import('@/components/admin/CampaignLinkBuilder'), { ssr: false });
const AnalyticsDashboard = dynamic(() => import('@/components/admin/AnalyticsDashboard'), { ssr: false });

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안',
  ACTIVE: '집행 중',
  PAUSED: '일시정지',
  ARCHIVED: '종료',
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-700',
  ARCHIVED: 'bg-red-50 text-red-600',
};

type MainTab = 'meta' | 'links' | 'performance';

interface PerformanceData {
  period: string;
  metrics: {
    ad: { roas_pct: number; total_spend: number; total_revenue: number };
    content: { blog_posts_published: number; avg_serp_rank: number | null };
    pipeline: { tasks_done: number; tasks_failed: number; success_rate: number };
  };
  trend: TrendPoint[];
  recent_tasks: {
    agent_type: string;
    performative: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    duration_ms: number | null;
    last_error: string | null;
  }[];
}

export default function MarketingDashboardPage() {
  const [mainTab, setMainTab] = useState<MainTab>('meta');
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const perfFetchedRef = useRef(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [topCampaigns, setTopCampaigns] = useState<AdCampaign[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyAdStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<string | null>(null);

  // KPI 산식 기준 토글 (2026-04-28)
  // marketing 의 default 는 accounting (snapshot의 attributed_margin = departure_date 기반)
  // commission 으로 토글 시 bookings 의 created_at 기준으로 마진 재계산
  const [basis, setBasis] = useState<KPIBasis>('accounting');
  const basisMeta = getBasisMeta(basis);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [campRes, perfRes] = await Promise.all([
        fetch('/api/meta/campaigns'),
        fetch(`/api/meta/performance?type=monthly&months=6&basis=${basis}`),
      ]);

      if (campRes.ok) {
        const { campaigns: list } = await campRes.json();
        setCampaigns(list ?? []);
        // Top 3: latest_roas 기준 정렬
        const sorted = [...(list ?? [])]
          .filter((c: AdCampaign) => c.latest_roas !== undefined)
          .sort((a: AdCampaign, b: AdCampaign) => (b.latest_roas ?? 0) - (a.latest_roas ?? 0))
          .slice(0, 3);
        setTopCampaigns(sorted);
      }
      if (perfRes.ok) {
        const { stats } = await perfRes.json();
        setMonthlyStats(stats ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [basis]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPerformance = useCallback(async () => {
    if (perfFetchedRef.current) return;
    perfFetchedRef.current = true;
    setPerfLoading(true);
    try {
      const res = await fetch('/api/admin/marketing-performance');
      if (res.ok) setPerfData(await res.json());
      else perfFetchedRef.current = false;
    } catch (err) {
      console.error(err);
      perfFetchedRef.current = false;
    } finally {
      setPerfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === 'performance') fetchPerformance();
  }, [mainTab, fetchPerformance]);

  const handleOptimize = async () => {
    setOptimizing(true);
    setOptimizeResult(null);
    try {
      const res = await fetch('/api/meta/optimize', { method: 'POST' });
      const data = await res.json();
      setOptimizeResult(
        `처리: ${data.processed}개 | 일시정지: ${data.paused?.length ?? 0}개 | 예산증액: ${data.scaled?.length ?? 0}개`
      );
      fetchData();
    } finally {
      setOptimizing(false);
    }
  };

  const handleCampaignStatus = async (id: string, status: string) => {
    await fetch(`/api/meta/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchData();
  };

  // KPI 집계
  const totalSpend = campaigns.reduce((s, c) => s + (c.total_spend_krw ?? 0), 0);
  const activeCnt = campaigns.filter(c => c.status === 'ACTIVE').length;
  const latestRoasArr = campaigns
    .filter(c => (c.latest_roas ?? 0) > 0)
    .map(c => c.latest_roas ?? 0);
  const avgRoas = latestRoasArr.length
    ? Math.round(latestRoasArr.reduce((s, r) => s + r, 0) / latestRoasArr.length)
    : 0;
  const totalAttributedMargin = monthlyStats.reduce(
    (s, m) => s + (m.total_attributed_margin ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-admin-lg font-bold text-slate-800">마케팅 센터</h1>
          <p className="text-admin-sm text-slate-500 mt-1">
            Meta Ads 성과 분석 / 캠페인 링크 & QR 빌더
            <span className="ml-2 text-[11px] text-slate-400">· {basisMeta.description}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mainTab === 'meta' && (
            <KPIBasisToggle value={basis} onChange={setBasis} size="sm" />
          )}
          {mainTab === 'links' ? (
            <button
              onClick={() => setBuilderOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              + 새 링크 만들기
            </button>
          ) : (
            <>
              <button
                onClick={handleOptimize}
                disabled={optimizing}
                className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {optimizing ? '최적화 중...' : '자동 최적화 실행'}
              </button>
              <Link
                href="/admin/marketing/campaigns"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-sm font-medium rounded-lg hover:bg-slate-50"
              >
                + 캠페인 생성
              </Link>
              <Link
                href="/admin/marketing/creatives"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-sm font-medium rounded-lg hover:bg-slate-50"
              >
                AI 소재 생성
              </Link>
              <Link
                href="/admin/marketing/card-news"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-sm font-medium rounded-lg hover:bg-slate-50"
              >
                카드뉴스
              </Link>
              <Link
                href="/admin/marketing/brand-kits"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-sm font-medium rounded-lg hover:bg-slate-50"
              >
                브랜드킷
              </Link>
            </>
          )}
        </div>
      </div>

      {/* 탭 스위처 */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit border border-slate-200">
        {([
          { key: 'meta',        label: 'Meta 광고' },
          { key: 'performance', label: '통합 퍼포먼스' },
          { key: 'links',       label: '링크 센터' },
        ] as { key: MainTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key)}
            className={`px-5 py-2 rounded-md text-admin-sm font-semibold transition-all ${
              mainTab === tab.key
                ? 'bg-white text-slate-800 border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 통합 퍼포먼스 탭 */}
      {mainTab === 'performance' && (
        <div className="space-y-4">
          {/* KPI 카드 3종 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricsCard
              label="광고 ROAS"
              value={perfData?.metrics.ad.roas_pct ?? 0}
              unit="%"
              sublabel={`지출 ${((perfData?.metrics.ad.total_spend ?? 0) / 10000).toFixed(0)}만 → 수익 ${((perfData?.metrics.ad.total_revenue ?? 0) / 10000).toFixed(0)}만`}
              loading={perfLoading}
            />
            <MetricsCard
              label="블로그 발행 (7일)"
              value={perfData?.metrics.content.blog_posts_published ?? 0}
              unit="건"
              sublabel={perfData?.metrics.content.avg_serp_rank != null ? `평균 SERP ${perfData.metrics.content.avg_serp_rank}위` : undefined}
              loading={perfLoading}
            />
            <MetricsCard
              label="파이프라인 성공률"
              value={perfData?.metrics.pipeline.success_rate ?? 0}
              unit="%"
              sublabel={`완료 ${perfData?.metrics.pipeline.tasks_done ?? 0} / 실패 ${perfData?.metrics.pipeline.tasks_failed ?? 0}`}
              loading={perfLoading}
            />
          </div>

          {/* 7일 추이 차트 */}
          <PerformanceTrend data={perfData?.trend ?? []} loading={perfLoading} />

          {/* 최근 에이전트 실행 로그 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-admin-base font-semibold text-slate-800">최근 에이전트 실행 로그</h2>
              <Link href="/admin/agent-mas" className="text-admin-xs text-blue-600 hover:underline">전체 보기 →</Link>
            </div>
            {perfLoading ? (
              <div className="divide-y divide-slate-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-4 animate-pulse">
                    <div className="h-3 w-16 bg-slate-100 rounded" />
                    <div className="h-3 w-24 bg-slate-100 rounded" />
                    <div className="h-4 w-10 bg-slate-100 rounded-full" />
                    <div className="h-3 w-12 bg-slate-100 rounded ml-auto" />
                    <div className="h-3 w-8 bg-slate-100 rounded" />
                  </div>
                ))}
              </div>
            ) : !perfData?.recent_tasks.length ? (
              <div className="p-10 text-center">
                <svg className="w-8 h-8 text-slate-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-admin-sm text-slate-400">최근 7일간 실행 기록이 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-admin-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {['에이전트', '작업', '상태', '시작', '소요', '오류'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {perfData.recent_tasks.map((t, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">{t.agent_type}</td>
                        <td className="px-3 py-2 text-slate-500">{t.performative}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            t.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            {t.status === 'done' ? '완료' : '실패'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-[11px]">
                          {t.started_at ? new Date(t.started_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '--'}
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-[11px]">
                          {t.duration_ms != null ? `${(t.duration_ms / 1000).toFixed(1)}s` : '--'}
                        </td>
                        <td className="px-3 py-2 text-red-500 text-[11px] max-w-xs truncate">
                          {t.last_error ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 링크 센터 탭 */}
      {mainTab === 'links' && (
        <>
          <AnalyticsDashboard />
          <CampaignLinkBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />
        </>
      )}

      {/* Meta 광고 탭 */}
      {mainTab === 'meta' && (<>

      {optimizeResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-admin-sm text-blue-700">
          {optimizeResult}
        </div>
      )}

      {/* KPI 카드 4종 — basis-aware */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          {
            label: '총 광고비 지출', value: `${(totalSpend / 10000).toFixed(0)}만원`, color: 'text-red-600', iconBg: 'bg-red-50', sub: '캠페인 합계',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>,
          },
          {
            label: `귀속 마진 · ${basisMeta.shortLabel}`, value: `${(totalAttributedMargin / 10000).toFixed(0)}만원`, color: 'text-emerald-600', iconBg: 'bg-emerald-50', sub: basis === 'accounting' ? '출발 완료 기준' : '예약 생성 기준',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>,
          },
          {
            label: `Net ROAS · ${basisMeta.shortLabel}`, value: `${avgRoas}%`, color: avgRoas >= 200 ? 'text-emerald-600' : avgRoas >= 100 ? 'text-amber-600' : 'text-red-600', iconBg: avgRoas >= 200 ? 'bg-emerald-50' : avgRoas >= 100 ? 'bg-amber-50' : 'bg-red-50', sub: '마진/광고비',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
          },
          {
            label: '활성 캠페인', value: `${activeCnt}개`, color: 'text-blue-700', iconBg: 'bg-blue-50', sub: 'ACTIVE 상태',
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" /></svg>,
          },
        ] as { label: string; value: string; color: string; iconBg: string; sub: string; icon: React.ReactNode }[]).map(({ label, value, color, iconBg, sub, icon }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex items-center gap-3">
            <div className={`shrink-0 w-9 h-9 rounded-lg ${iconBg} ${color} flex items-center justify-center`}>
              {icon}
            </div>
            <div className="min-w-0">
              <p className={`text-[20px] font-black tabular-nums leading-tight ${color}`}>{value}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-none truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 월별 광고비 vs 마진 LineChart */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6">
        <h2 className="text-admin-base font-semibold text-slate-800 mb-4">
          월별 광고비 vs 귀속 마진 (6개월) <span className="text-[11px] text-slate-400">· {basisMeta.shortLabel} 기준</span>
        </h2>
        {monthlyStats.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <svg className="w-8 h-8 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
            <p className="text-admin-sm font-medium text-slate-500">성과 데이터가 없습니다.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyStats} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5) + '월'}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}만`}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const numVal = typeof value === 'number' ? value : 0;
                  const label = name === 'total_spend_krw' ? '광고비' : '귀속 마진';
                  return [`${(numVal / 10000).toFixed(0)}만원`, label] as [string, string];
                }}
                labelFormatter={(label: unknown) => `${String(label).slice(0, 7)}`}
              />
              <Legend
                formatter={(value: unknown) =>
                  value === 'total_spend_krw' ? '광고비' : '귀속 마진'
                }
              />
              <Line
                type="monotone"
                dataKey="total_spend_krw"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="total_attributed_margin"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top 3 캠페인 */}
      <div>
        <h2 className="text-admin-base font-semibold text-slate-800 mb-3">Top 3 캠페인 (Net ROAS 기준)</h2>
        {topCampaigns.length === 0 ? (
          <p className="text-admin-sm text-slate-400">성과 데이터가 있는 캠페인이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topCampaigns.map((c, idx) => {
              const grade = getRoasGrade(c.latest_roas ?? 0);
              return (
                <div key={c.id} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5">
                  <div className="flex items-start justify-between">
                    <span className="text-xl font-bold text-slate-300">#{idx + 1}</span>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${grade.bgColor} ${grade.color}`}>
                      ROAS {(c.latest_roas ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-admin-base font-semibold text-slate-800 mt-2 line-clamp-2">{c.name}</p>
                  <p className="text-admin-sm text-slate-500 mt-1">{c.package_destination ?? '--'}</p>
                  <div className="mt-3 text-admin-sm text-slate-500 flex justify-between">
                    <span>광고비 {((c.total_spend_krw ?? 0) / 10000).toFixed(0)}만원</span>
                    <span className={`font-medium ${STATUS_BADGE[c.status]?.includes('emerald') ? 'text-emerald-600' : ''}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 캠페인 전체 테이블 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-admin-base font-semibold text-slate-800">전체 캠페인</h2>
        </div>
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
                <div className="h-4 bg-slate-100 rounded-full animate-pulse w-16" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center text-admin-sm text-slate-400">
            캠페인이 없습니다.{' '}
            <Link href="/admin/marketing/campaigns" className="text-blue-700 underline">
              첫 캠페인 만들기
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">캠페인명</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">연결 상품</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">상태</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-slate-500">일예산</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-slate-500">총 지출</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-slate-500">Net ROAS</th>
                  <th className="px-3 py-2 text-center text-[11px] font-medium text-slate-500">액션</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const roas = c.latest_roas ?? 0;
                  const grade = getRoasGrade(roas);
                  return (
                    <tr key={c.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800 max-w-xs truncate">{c.name}</div>
                        {c.auto_pause_reason && (
                          <div className="text-[11px] text-red-500 mt-0.5 truncate">{c.auto_pause_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">
                        {c.package_title ?? '--'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STATUS_BADGE[c.status]}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {((c.daily_budget_krw ?? 0) / 10000).toFixed(0)}만
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {((c.total_spend_krw ?? 0) / 10000).toFixed(0)}만
                      </td>
                      <td className="px-3 py-2 text-right">
                        {roas > 0 ? (
                          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${grade.bgColor} ${grade.color}`}>
                            {roas.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">--</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2 justify-center">
                          {c.status === 'ACTIVE' ? (
                            <button
                              onClick={() => handleCampaignStatus(c.id, 'PAUSED')}
                              className="text-[11px] px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                            >
                              일시정지
                            </button>
                          ) : c.status === 'PAUSED' ? (
                            <button
                              onClick={() => handleCampaignStatus(c.id, 'ACTIVE')}
                              className="text-[11px] px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100"
                            >
                              재개
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleCampaignStatus(c.id, 'ARCHIVED')}
                            className="text-[11px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                          >
                            종료
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>)} {/* end mainTab === 'meta' */}
    </div>
  );
}
