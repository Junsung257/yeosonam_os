'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getRoasGrade } from '@/lib/roas-calculator';
import type { AdCampaign, MonthlyAdStats } from '@/types/meta-ads';

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

type MainTab = 'meta' | 'links';

export default function MarketingDashboardPage() {
  const [mainTab, setMainTab] = useState<MainTab>('meta');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [topCampaigns, setTopCampaigns] = useState<AdCampaign[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyAdStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [campRes, perfRes] = await Promise.all([
        fetch('/api/meta/campaigns'),
        fetch('/api/meta/performance?type=monthly&months=6'),
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
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">마케팅 센터</h1>
          <p className="text-[13px] text-slate-500 mt-1">Meta Ads 성과 분석 / 캠페인 링크 & QR 빌더</p>
        </div>
        <div className="flex gap-2">
          {mainTab === 'links' ? (
            <button
              onClick={() => setBuilderOpen(true)}
              className="px-4 py-2 bg-[#001f3f] text-white text-[13px] font-semibold rounded-lg hover:bg-blue-900 transition"
            >
              + 새 링크 만들기
            </button>
          ) : (
            <>
              <button
                onClick={handleOptimize}
                disabled={optimizing}
                className="px-4 py-2 bg-[#001f3f] text-white text-[13px] font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50"
              >
                {optimizing ? '최적화 중...' : '자동 최적화 실행'}
              </button>
              <Link
                href="/admin/marketing/campaigns"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] font-medium rounded-lg hover:bg-slate-50"
              >
                + 캠페인 생성
              </Link>
              <Link
                href="/admin/marketing/creatives"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] font-medium rounded-lg hover:bg-slate-50"
              >
                AI 소재 생성
              </Link>
              <Link
                href="/admin/marketing/card-news"
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] font-medium rounded-lg hover:bg-slate-50"
              >
                카드뉴스
              </Link>
            </>
          )}
        </div>
      </div>

      {/* 탭 스위처 */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit border border-slate-200">
        {([
          { key: 'meta',  label: 'Meta 광고' },
          { key: 'links', label: '링크 센터' },
        ] as { key: MainTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key)}
            className={`px-5 py-2 rounded-md text-[13px] font-semibold transition-all ${
              mainTab === tab.key
                ? 'bg-white text-slate-800 border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[13px] text-blue-700">
          {optimizeResult}
        </div>
      )}

      {/* KPI 카드 4종 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '총 광고비 지출', value: `${(totalSpend / 10000).toFixed(0)}만원`, color: 'text-red-600' },
          { label: '귀속 마진 합계', value: `${(totalAttributedMargin / 10000).toFixed(0)}만원`, color: 'text-emerald-600' },
          { label: '평균 Net ROAS', value: `${avgRoas}%`, color: avgRoas >= 200 ? 'text-emerald-600' : avgRoas >= 100 ? 'text-amber-600' : 'text-red-600' },
          { label: '활성 캠페인', value: `${activeCnt}개`, color: 'text-blue-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[13px] text-slate-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* 월별 광고비 vs 마진 LineChart */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-[14px] font-semibold text-slate-800 mb-4">월별 광고비 vs 귀속 마진 (6개월)</h2>
        {monthlyStats.length === 0 ? (
          <p className="text-[13px] text-slate-400 text-center py-10">성과 데이터가 없습니다.</p>
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
        <h2 className="text-[14px] font-semibold text-slate-800 mb-3">Top 3 캠페인 (Net ROAS 기준)</h2>
        {topCampaigns.length === 0 ? (
          <p className="text-[13px] text-slate-400">성과 데이터가 있는 캠페인이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topCampaigns.map((c, idx) => {
              const grade = getRoasGrade(c.latest_roas ?? 0);
              return (
                <div key={c.id} className="bg-white rounded-lg border border-slate-200 p-5">
                  <div className="flex items-start justify-between">
                    <span className="text-xl font-bold text-slate-300">#{idx + 1}</span>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${grade.bgColor} ${grade.color}`}>
                      ROAS {(c.latest_roas ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold text-slate-800 mt-2 line-clamp-2">{c.name}</p>
                  <p className="text-[13px] text-slate-500 mt-1">{c.package_destination ?? '--'}</p>
                  <div className="mt-3 text-[13px] text-slate-500 flex justify-between">
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
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-[14px] font-semibold text-slate-800">전체 캠페인</h2>
        </div>
        {loading ? (
          <div className="p-10 text-center text-[13px] text-slate-400">불러오는 중...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-slate-400">
            캠페인이 없습니다.{' '}
            <Link href="/admin/marketing/campaigns" className="text-blue-700 underline">
              첫 캠페인 만들기
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
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
