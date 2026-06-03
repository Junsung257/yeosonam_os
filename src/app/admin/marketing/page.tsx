'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useMarketingGap } from '@/hooks/useMarketingGap';
import MetricsCard from '@/components/admin/MetricsCard';
import ChannelComparisonTable from '@/components/admin/marketing/ChannelComparisonTable';
import ConversionFunnel from '@/components/admin/marketing/ConversionFunnel';
import BlendedTrendChart from '@/components/admin/marketing/BlendedTrendChart';
import JarvisQuickAsk from '@/components/admin/JarvisQuickAsk';
import type { AdCampaign } from '@/types/meta-ads';
import { completionAuditTone, type CompletionAuditView } from '@/lib/ad-os-completion-view';
import { fetchWithSessionRefresh } from '@/lib/fetch-with-session-refresh';
import { getRoasGrade } from '@/lib/roas-calculator';

const CampaignLinkBuilder = dynamic(() => import('@/components/admin/CampaignLinkBuilder'), { ssr: false });
const AnalyticsDashboard = dynamic(() => import('@/components/admin/AnalyticsDashboard'), { ssr: false });

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', ACTIVE: '집행 중', PAUSED: '일시정지', ARCHIVED: '종료',
};
const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-admin-surface-2 text-admin-muted', ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-700', ARCHIVED: 'bg-red-50 text-red-600',
};

type MainTab = 'dashboard' | 'meta' | 'links' | 'optimize';
type AdOsMode = 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';

interface AdOsMainSummary {
  ok?: boolean;
  channel_execution_states?: Record<string, {
    label: string;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
    canSpend: boolean;
    summary: string;
    nextAction: string;
  }>;
  active_automation_modes?: Array<{
    platform: string;
    level: number;
    mode: AdOsMode;
    status: string;
  }>;
  tenant_policy?: {
    configured: boolean;
    max_automation_level: number;
    monthly_budget_cap_krw: number;
    risk_status: string;
    full_auto_enabled: boolean;
  };
  enterprise_layer?: {
    completion_audit?: CompletionAuditView;
  };
}

function formatWon(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${(v / 10000).toFixed(0)}만`;
  return v.toLocaleString('ko-KR');
}

function adOsModeLabel(mode?: AdOsMode): string {
  if (mode === 'full_auto') return '완전자동';
  if (mode === 'limited_auto') return '제한 예산 자동집행';
  if (mode === 'approval') return '승인';
  return '추천';
}

function adOsToneClass(tone: 'good' | 'warn' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'warn') return 'bg-amber-50 text-amber-700';
  if (tone === 'bad') return 'bg-red-50 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

export default function MarketingDashboardPage() {
  const [mainTab, setMainTab] = useState<MainTab>('dashboard');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<string | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [adOsSummary, setAdOsSummary] = useState<AdOsMainSummary | null>(null);
  const [adOsError, setAdOsError] = useState<string | null>(null);

  // 통합 대시보드 데이터 — useMarketingGap 훅이 mock/real 모두 커버
  const { dashboardData, loading: dashLoading, refresh: refreshDash } = useMarketingGap(true);

  const fetchCampaigns = useCallback(async () => {
    setCampaignLoading(true);
    try {
      const res = await fetch('/api/meta/campaigns');
      if (res.ok) {
        const { campaigns: list } = await res.json();
        setCampaigns(list ?? []);
      }
    } catch { /* noop */ }
    finally { setCampaignLoading(false); }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  useEffect(() => {
    let alive = true;
    fetchWithSessionRefresh('/api/admin/ad-os/summary', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !json.ok) {
          setAdOsSummary(null);
          setAdOsError(json.error || `HTTP ${res.status}`);
          return;
        }
        setAdOsSummary(json);
        setAdOsError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setAdOsSummary(null);
        setAdOsError(err instanceof Error ? err.message : 'Ad OS 상태 조회 실패');
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleOptimize = async () => {
    setOptimizing(true);
    setOptimizeResult(null);
    try {
      const res = await fetch('/api/meta/optimize', { method: 'POST' });
      const data = await res.json();
      setOptimizeResult(`처리: ${data.processed}개 | 일시정지: ${data.paused?.length ?? 0}개 | 예산증액: ${data.scaled?.length ?? 0}개`);
      fetchCampaigns();
    } finally { setOptimizing(false); }
  };

  const handleCampaignStatus = async (id: string, status: string) => {
    await fetch(`/api/meta/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchCampaigns();
  };

  // Meta 캠페인 집계
  const totalSpend = campaigns.reduce((s, c) => s + (c.total_spend_krw ?? 0), 0);
  const activeCnt = campaigns.filter(c => c.status === 'ACTIVE').length;
  const latestRoasArr = campaigns.filter(c => (c.latest_roas ?? 0) > 0).map(c => c.latest_roas ?? 0);
  const avgRoas = latestRoasArr.length ? Math.round(latestRoasArr.reduce((s, r) => s + r, 0) / latestRoasArr.length) : 0;
  const topCampaigns = useMemo(() =>
    [...campaigns]
      .filter(c => c.latest_roas !== undefined)
      .sort((a, b) => (b.latest_roas ?? 0) - (a.latest_roas ?? 0))
      .slice(0, 3),
  [campaigns]);
  const adOsModes = new Map((adOsSummary?.active_automation_modes || []).map((mode) => [mode.platform, mode]));
  const adOsStates = Object.entries(adOsSummary?.channel_execution_states || {}).filter(([platform]) => ['naver', 'google'].includes(platform));
  const completionAudit = adOsSummary?.enterprise_layer?.completion_audit;

  return (
    <div className="space-y-6">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text-2">통합 광고 마케팅</h1>
          <p className="text-admin-sm text-admin-muted mt-1">
            Google Ads · Naver Ads · Meta Ads · Organic 통합 성과 대시보드
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mainTab === 'meta' && (
            <>
              <button
                onClick={handleOptimize}
                disabled={optimizing}
                className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {optimizing ? '최적화 중...' : '자동 최적화 실행'}
              </button>
              <Link href="/admin/marketing/campaigns" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
                + 캠페인 생성
              </Link>
              <Link href="/admin/marketing/creatives" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
                AI 소재 생성
              </Link>
            </>
          )}
          {mainTab === 'links' && (
            <button onClick={() => setBuilderOpen(true)} className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-blue-700 transition">
              + 새 링크 만들기
            </button>
          )}
          <Link href="/admin/marketing/command-center" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            Command Center
          </Link>
          <Link href="/admin/marketing/system-health" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            System Health
          </Link>
          <Link href="/admin/marketing/card-news" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            카드뉴스
          </Link>
          <Link href="/admin/marketing/brand-kits" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            브랜드킷
          </Link>
          <Link href="/admin/marketing/social-configs" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            소셜 설정
          </Link>
          <Link href="/admin/marketing-intelligence" className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm font-medium rounded-lg hover:bg-admin-bg">
            인텔리전스
          </Link>
        </div>
      </div>

      {/* ── 탭 스위처 ── */}
      <div className="flex gap-1 p-1 bg-admin-surface-2 rounded-lg w-fit border border-admin-border-mid">
        {([
          { key: 'dashboard', label: '통합 대시보드' },
          { key: 'meta', label: 'Meta 광고' },
          { key: 'links', label: '링크 센터' },
        ] as { key: MainTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setMainTab(tab.key)}
            className={`px-5 py-2 rounded-md text-admin-sm font-semibold transition-all ${
              mainTab === tab.key
                ? 'bg-white text-admin-text-2 border border-admin-border-mid shadow-sm'
                : 'text-admin-muted hover:text-admin-text-2 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          TAB 1: 통합 대시보드
         ════════════════════════════════════════════════════════════════════ */}
      {mainTab === 'dashboard' && (
        <div className="space-y-6">
          <section className="rounded-admin-md border border-admin-border-mid bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">Ad OS V1 집행 상태</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  마케팅 대시보드는 성과를 보고, Ad OS는 네이버/구글 집행 가능 여부와 자동화 권한을 통제합니다.
                </p>
              </div>
              <Link href="/admin/ad-os" className="rounded-lg border border-admin-border-strong bg-white px-4 py-2 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-bg">
                Ad OS 열기
              </Link>
            </div>
            {adOsError ? (
              <div className="mt-3 rounded-admin-sm border border-amber-200 bg-amber-50 p-3 text-admin-sm text-amber-800">
                Ad OS 상태를 불러오지 못했습니다: {adOsError}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                {adOsStates.map(([platform, state]) => {
                  const mode = adOsModes.get(platform);
                  return (
                    <div key={platform} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-admin-sm font-semibold text-admin-text-2">{platform === 'naver' ? '네이버 검색광고' : '구글 광고'}</p>
                          <p className="mt-1 text-admin-xs text-admin-muted">{state.summary}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-admin-xs font-semibold ${adOsToneClass(state.tone)}`}>{state.label}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-admin-xs">
                        <span className="rounded-admin-xs bg-admin-surface-2 px-2 py-1 text-admin-muted">모드 {adOsModeLabel(mode?.mode)}</span>
                        <span className="rounded-admin-xs bg-admin-surface-2 px-2 py-1 text-admin-muted">L{mode?.level ?? 1}</span>
                        <span className="rounded-admin-xs bg-admin-surface-2 px-2 py-1 text-admin-muted">{state.canSpend ? '집행 가능' : '집행 차단'}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <p className="text-admin-sm font-semibold text-admin-text-2">테넌트 가드레일</p>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    월 한도 {formatWon(adOsSummary?.tenant_policy?.monthly_budget_cap_krw || 0)}, 최대 L{adOsSummary?.tenant_policy?.max_automation_level ?? 2},
                    완전자동 {adOsSummary?.tenant_policy?.full_auto_enabled ? '허용' : '차단'}
                  </p>
                  <span className={`mt-3 inline-flex rounded-full px-2 py-0.5 text-admin-xs font-semibold ${adOsToneClass(adOsSummary?.tenant_policy?.configured ? 'good' : 'warn')}`}>
                    {adOsSummary?.tenant_policy?.configured ? '정책 설정됨' : '기본 정책'}
                  </span>
                </div>
                <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 lg:col-span-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-admin-sm font-semibold text-admin-text-2">Ad OS 완성도 감사</p>
                        <span className={`rounded-full px-2 py-0.5 text-admin-xs font-semibold ${adOsToneClass(completionAuditTone(completionAudit?.status))}`}>
                          {completionAudit?.status ?? 'checking'}
                        </span>
                      </div>
                      <p className="mt-1 text-admin-xs text-admin-muted">
                        {completionAudit
                          ? `${completionAudit.readiness_score}% 준비 | pass ${completionAudit.passed} / warn ${completionAudit.warnings} / fail ${completionAudit.failed}`
                          : '완성도 감사 증거를 불러오는 중입니다.'}
                      </p>
                      <p className="mt-1 text-admin-xs text-admin-muted">
                        {completionAudit?.next_action ?? 'System Health에서 Ad OS readiness를 확인하세요.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href="/admin/marketing/command-center" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
                        Command Center
                      </Link>
                      <Link href="/admin/marketing/system-health" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
                        System Health
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
          {/* Executive Summary Strip (상단 KPI 바) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricsCard
              label="Total Ad Spend"
              value={dashboardData ? formatWon(dashboardData.totalSpend) : '--'}
              delta={dashboardData?.prevTotalSpend && dashboardData.totalSpend > 0
                ? Math.round(((dashboardData.totalSpend - dashboardData.prevTotalSpend) / dashboardData.prevTotalSpend) * 100)
                : undefined}
              deltaLabel="전월비"
              loading={dashLoading}
            />
            <MetricsCard
              label="Total Conversions"
              value={dashboardData?.totalConversions ?? 0}
              unit="건"
              loading={dashLoading}
            />
            <MetricsCard
              label="Attributed Revenue"
              value={dashboardData ? formatWon(dashboardData.attributedRevenue) : '--'}
              delta={dashboardData?.prevTotalRevenue && dashboardData.attributedRevenue > 0
                ? Math.round(((dashboardData.attributedRevenue - dashboardData.prevTotalRevenue) / dashboardData.prevTotalRevenue) * 100)
                : undefined}
              deltaLabel="전월비"
              loading={dashLoading}
            />
            <MetricsCard
              label="Blended ROAS"
              value={dashboardData ? dashboardData.blendedRoas.toFixed(1) : '--'}
              unit="%"
              loading={dashLoading}
            />
            <MetricsCard
              label="Avg CPA"
              value={dashboardData ? formatWon(Math.round(dashboardData.avgCpa)) : '--'}
              loading={dashLoading}
            />
          </div>

          {/* 채널 비교 + 퍼널 — 2열 그리드 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 채널 비교 테이블 (2/3) */}
            <div className="lg:col-span-2 bg-white rounded-admin-md border border-admin-border-mid p-4">
              <h2 className="text-admin-base font-semibold text-admin-text-2 mb-4">채널별 성과 비교</h2>
              <ChannelComparisonTable data={dashboardData?.channels ?? []} loading={dashLoading} />
            </div>

            {/* 전환 퍼널 (1/3) */}
            <div className="bg-white rounded-admin-md border border-admin-border-mid p-4">
              <ConversionFunnel steps={dashboardData?.funnel ?? []} loading={dashLoading} />
            </div>
          </div>

          {/* 통합 트렌드 차트 */}
          <div className="bg-white rounded-admin-md border border-admin-border-mid p-4">
            <BlendedTrendChart data={dashboardData?.trends ?? []} loading={dashLoading} />
          </div>

          {/* 자비스 AI 퀵 */}
          <div className="w-full max-w-md ml-auto">
            <JarvisQuickAsk contentType="marketing" />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB 2: Meta 광고
         ════════════════════════════════════════════════════════════════════ */}
      {mainTab === 'meta' && (
        <>
          {optimizeResult && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-admin-sm text-blue-700">
              {optimizeResult}
            </div>
          )}

          {/* KPI 카드 4종 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { label: '총 광고비 지출', value: `${(totalSpend / 10000).toFixed(0)}만원`, color: 'text-red-600', iconBg: 'bg-red-50', sub: '캠페인 합계',
                icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>,
              },
              { label: '광고 마진', value: `${(campaigns.reduce((s, c) => s + ((c as unknown as { total_attributed_margin?: number }).total_attributed_margin ?? 0), 0) / 10000).toFixed(0)}만원`, color: 'text-emerald-600', iconBg: 'bg-emerald-50', sub: '귀속 마진 합계',
                icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>,
              },
              { label: 'Net ROAS', value: `${avgRoas}%`, color: avgRoas >= 200 ? 'text-emerald-600' : avgRoas >= 100 ? 'text-amber-600' : 'text-red-600', iconBg: avgRoas >= 200 ? 'bg-emerald-50' : avgRoas >= 100 ? 'bg-amber-50' : 'bg-red-50', sub: '마진/광고비',
                icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
              },
              { label: '활성 캠페인', value: `${activeCnt}개`, color: 'text-blue-700', iconBg: 'bg-blue-50', sub: 'ACTIVE 상태',
                icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" /></svg>,
              },
            ] as { label: string; value: string; color: string; iconBg: string; sub: string; icon: React.ReactNode }[]).map(({ label, value, color, iconBg, sub, icon }) => (
              <div key={label} className="bg-white rounded-admin-md border border-admin-border p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex items-center gap-3">
                <div className={`shrink-0 w-9 h-9 rounded-lg ${iconBg} ${color} flex items-center justify-center`}>{icon}</div>
                <div className="min-w-0">
                  <p className={`text-[20px] font-black tabular-nums leading-tight ${color}`}>{value}</p>
                  <p className="text-[11px] text-admin-muted-2 mt-0.5 leading-none truncate">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Top 3 캠페인 */}
          <div>
            <h2 className="text-admin-base font-semibold text-admin-text-2 mb-3">Top 3 캠페인 (Net ROAS 기준)</h2>
            {topCampaigns.length === 0 ? (
              <p className="text-admin-sm text-admin-muted-2">성과 데이터가 있는 캠페인이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {topCampaigns.map((c, idx) => {
                  const grade = getRoasGrade(c.latest_roas ?? 0);
                  return (
                    <div key={c.id} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
                      <div className="flex items-start justify-between">
                        <span className="text-xl font-bold text-admin-muted-2">#{idx + 1}</span>
                        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${grade.bgColor} ${grade.color}`}>
                          ROAS {(c.latest_roas ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-admin-base font-semibold text-admin-text-2 mt-2 line-clamp-2">{c.name}</p>
                      <p className="text-admin-sm text-admin-muted mt-1">{c.package_destination ?? '--'}</p>
                      <div className="mt-3 text-admin-sm text-admin-muted flex justify-between">
                        <span>광고비 {((c.total_spend_krw ?? 0) / 10000).toFixed(0)}만원</span>
                        <span className="font-medium">{STATUS_LABELS[c.status]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 캠페인 전체 테이블 */}
          <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-admin-border-mid">
              <h2 className="text-admin-base font-semibold text-admin-text-2">전체 캠페인</h2>
            </div>
            {campaignLoading ? (
              <div className="divide-y divide-slate-50">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
                    <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
                  </div>
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="p-10 text-center text-admin-sm text-admin-muted-2">
                캠페인이 없습니다.{' '}
                <Link href="/admin/marketing/campaigns" className="text-blue-700 underline">첫 캠페인 만들기</Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-admin-sm">
                  <thead>
                    <tr className="border-b border-admin-border-mid">
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">캠페인명</th>
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">연결 상품</th>
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">상태</th>
                      <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">일예산</th>
                      <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">총 지출</th>
                      <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Net ROAS</th>
                      <th className="px-3 py-2 text-center text-[11px] font-medium text-admin-muted">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => {
                      const roas = c.latest_roas ?? 0;
                      const grade = getRoasGrade(roas);
                      return (
                        <tr key={c.id} className="border-b border-admin-border-mid hover:bg-admin-bg">
                          <td className="px-3 py-2">
                            <div className="font-medium text-admin-text-2 max-w-xs truncate">{c.name}</div>
                            {c.auto_pause_reason && <div className="text-[11px] text-red-500 mt-0.5 truncate">{c.auto_pause_reason}</div>}
                          </td>
                          <td className="px-3 py-2 text-admin-muted max-w-xs truncate">{c.package_title ?? '--'}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STATUS_BADGE[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-admin-muted">{((c.daily_budget_krw ?? 0) / 10000).toFixed(0)}만</td>
                          <td className="px-3 py-2 text-right text-admin-muted">{((c.total_spend_krw ?? 0) / 10000).toFixed(0)}만</td>
                          <td className="px-3 py-2 text-right">
                            {roas > 0 ? (
                              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${grade.bgColor} ${grade.color}`}>{roas.toFixed(1)}%</span>
                            ) : (
                              <span className="text-admin-muted-2 text-[11px]">--</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2 justify-center">
                              {c.status === 'ACTIVE' ? (
                                <button onClick={() => handleCampaignStatus(c.id, 'PAUSED')} className="text-[11px] px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100">일시정지</button>
                              ) : c.status === 'PAUSED' ? (
                                <button onClick={() => handleCampaignStatus(c.id, 'ACTIVE')} className="text-[11px] px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">재개</button>
                              ) : null}
                              <button onClick={() => handleCampaignStatus(c.id, 'ARCHIVED')} className="text-[11px] px-2 py-1 bg-admin-surface-2 text-admin-muted rounded hover:bg-slate-200">종료</button>
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
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB 3: 링크 센터
         ════════════════════════════════════════════════════════════════════ */}
      {mainTab === 'links' && (
        <>
          <AnalyticsDashboard />
          <CampaignLinkBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />
        </>
      )}
    </div>
  );
}
