'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';

const BarChart = dynamic(() => import('recharts').then(m => ({ default: m.BarChart })), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const LineChart = dynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });

interface KeywordStatsSummary {
  total_keywords: number;
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  avg_ctr: number;
  avg_cpc: number;
  total_conversions: number;
  avg_roas: number;
}

interface KeywordRanking {
  keyword: string;
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  conversions: number;
  roas: number;
}

interface SearchTermInfo {
  search_term: string;
  keyword: string;
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  first_seen: string;
  last_seen: string;
}

const PLATFORM_LABELS: Record<string, string> = { naver: '네이버', google: '구글', meta: '메타' };
const PLATFORM_COLORS: Record<string, string> = { naver: '#03C75A', google: '#4285F4', meta: '#1877F2' };

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '-';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '-';
  return `₩${n.toLocaleString('ko-KR')}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

export default function KeywordStatsPage() {
  const [platform, setPlatform] = useState<string>('all');
  const [summary, setSummary] = useState<KeywordStatsSummary | null>(null);
  const [topKeywords, setTopKeywords] = useState<KeywordRanking[]>([]);
  const [bottomKeywords, setBottomKeywords] = useState<KeywordRanking[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTermInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'top' | 'search-terms'>('overview');

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const summaryParams = new URLSearchParams();
        const topParams = new URLSearchParams({ _path: 'top' });
        const termsParams = new URLSearchParams({ _path: 'search-terms' });
        if (platform !== 'all') {
          summaryParams.set('platform', platform);
          topParams.set('platform', platform);
          termsParams.set('platform', platform);
        }
        const [summaryRes, topRes, termsRes] = await Promise.all([
          fetch(`/api/admin/keyword-stats?${summaryParams.toString()}`),
          fetch(`/api/admin/keyword-stats?${topParams.toString()}`),
          fetch(`/api/admin/keyword-stats?${termsParams.toString()}`),
        ]);
        if (summaryRes.ok) setSummary((await summaryRes.json()) as KeywordStatsSummary);
        if (topRes.ok) {
          const topData = (await topRes.json()) as { top: KeywordRanking[]; bottom: KeywordRanking[] };
          setTopKeywords(topData.top ?? []);
          setBottomKeywords(topData.bottom ?? []);
        }
        if (termsRes.ok) setSearchTerms((await termsRes.json()) as SearchTermInfo[]);
      } catch (err) {
        console.error('Failed to load keyword stats:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [platform]);

  const chartData = useMemo(() => {
    return topKeywords.slice(0, 10).map(k => ({
      name: k.keyword.length > 12 ? k.keyword.slice(0, 12) + '…' : k.keyword,
      ctr: +(k.ctr * 100).toFixed(2),
      cpc: k.cpc,
    }));
  }, [topKeywords]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-admin-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-admin-surface-2 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-admin-text">키워드 성과 대시보드</h1>
        <div className="flex gap-2">
          {['all', 'naver', 'google', 'meta'].map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-admin-md text-admin-sm transition-colors ${
                platform === p
                  ? 'bg-brand text-white'
                  : 'bg-admin-surface-2 text-admin-text-2 hover:bg-admin-surface-3'
              }`}
            >
              {p === 'all' ? '전체' : PLATFORM_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {/* 요약 KPI */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="총 키워드" value={fmt(summary.total_keywords)} change={null} />
          <KpiCard label="총 노출" value={fmt(summary.total_impressions)} change={null} />
          <KpiCard label="총 클릭" value={fmt(summary.total_clicks)} change={null} />
          <KpiCard label="총 지출" value={fmtMoney(summary.total_spend)} change={null} />
          <KpiCard label="평균 CTR" value={fmtPct(summary.avg_ctr)} change={null} />
          <KpiCard label="평균 CPC" value={fmtMoney(summary.avg_cpc)} change={null} />
          <KpiCard label="총 전환" value={fmt(summary.total_conversions)} change={null} />
          <KpiCard label="평균 ROAS" value={summary.avg_roas != null ? `${(summary.avg_roas * 100).toFixed(0)}%` : '-'} change={null} />
        </div>
      )}

      {/* 탭 내비게이션 */}
      <div className="flex gap-1 border-b border-admin-border">
        {(['overview', 'top', 'search-terms'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-admin-sm border-b-2 transition-colors ${
              tab === t
                ? 'border-brand text-brand font-medium'
                : 'border-transparent text-admin-text-2 hover:text-admin-text'
            }`}
          >
            {t === 'overview' ? '성과 개요' : t === 'top' ? '키워드 랭킹' : '검색어 분석'}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CTR Top 10 차트 */}
          <div className="bg-admin-surface rounded-xl border border-admin-border p-4">
            <h3 className="text-admin-sm font-medium text-admin-text mb-4">CTR Top 10</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="ctr" fill="#4285F4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 플랫폼별 분포 */}
          <div className="bg-admin-surface rounded-xl border border-admin-border p-4">
            <h3 className="text-admin-sm font-medium text-admin-text mb-4">플랫폼별 성과</h3>
            <div className="space-y-3">
              {['all', 'naver', 'google', 'meta'].filter(p => p !== 'all').map(p => {
                const kw = topKeywords.filter(k => k.platform === p).length;
                const total = topKeywords.length || 1;
                const barWidth = (kw / Math.min(total, 20)) * 100;
                return (
                  <div key={p}>
                    <div className="flex justify-between text-admin-sm mb-1">
                      <span className="text-admin-text">{PLATFORM_LABELS[p] ?? p}</span>
                      <span className="text-admin-text-2">{kw}개 키워드</span>
                    </div>
                    <div className="h-2 bg-admin-surface-2 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(barWidth, 4)}%`, backgroundColor: PLATFORM_COLORS[p] ?? '#888' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'top' && (
        <div className="space-y-6">
          {/* 상위 키워드 */}
          <div>
            <h3 className="text-admin-sm font-medium text-admin-text mb-3">성과 상위 키워드 (CTR 기준)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-admin-sm">
                <thead>
                  <tr className="border-b border-admin-border text-admin-text-2">
                    <th className="text-left py-2 px-3">키워드</th>
                    <th className="text-right py-2 px-3">노출</th>
                    <th className="text-right py-2 px-3">클릭</th>
                    <th className="text-right py-2 px-3">CTR</th>
                    <th className="text-right py-2 px-3">CPC</th>
                    <th className="text-right py-2 px-3">지출</th>
                    <th className="text-right py-2 px-3">전환</th>
                    <th className="text-right py-2 px-3">ROAS</th>
                    <th className="text-center py-2 px-3">플랫폼</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeywords.map((kw, i) => (
                    <tr key={i} className="border-b border-admin-border hover:bg-admin-surface-2 transition-colors">
                      <td className="py-2 px-3 text-admin-text font-medium">{kw.keyword}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmt(kw.impressions)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmt(kw.clicks)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmtPct(kw.ctr)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmtMoney(kw.cpc)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmtMoney(kw.spend)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmt(kw.conversions)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{kw.roas != null ? `${(kw.roas * 100).toFixed(0)}%` : '-'}</td>
                      <td className="py-2 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${PLATFORM_COLORS[kw.platform] ?? '#888'}20`, color: PLATFORM_COLORS[kw.platform] ?? '#888' }}>
                          {PLATFORM_LABELS[kw.platform] ?? kw.platform}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하위 키워드 */}
          {bottomKeywords.length > 0 && (
            <div>
              <h3 className="text-admin-sm font-medium text-admin-text mb-3 text-danger">성과 하위 키워드</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-admin-sm">
                  <thead>
                    <tr className="border-b border-admin-border text-admin-text-2">
                      <th className="text-left py-2 px-3">키워드</th>
                      <th className="text-right py-2 px-3">노출</th>
                      <th className="text-right py-2 px-3">클릭</th>
                      <th className="text-right py-2 px-3">CTR</th>
                      <th className="text-right py-2 px-3">지출</th>
                      <th className="text-center py-2 px-3">플랫폼</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bottomKeywords.map((kw, i) => (
                      <tr key={i} className="border-b border-admin-border hover:bg-admin-surface-2 transition-colors">
                        <td className="py-2 px-3 text-admin-text font-medium">{kw.keyword}</td>
                        <td className="py-2 px-3 text-right text-admin-text-2">{fmt(kw.impressions)}</td>
                        <td className="py-2 px-3 text-right text-admin-text-2">{fmt(kw.clicks)}</td>
                        <td className="py-2 px-3 text-right text-red-500">{fmtPct(kw.ctr)}</td>
                        <td className="py-2 px-3 text-right text-admin-text-2">{fmtMoney(kw.spend)}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${PLATFORM_COLORS[kw.platform] ?? '#888'}20`, color: PLATFORM_COLORS[kw.platform] ?? '#888' }}>
                            {PLATFORM_LABELS[kw.platform] ?? kw.platform}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'search-terms' && (
        <div>
          {searchTerms.length === 0 ? (
            <div className="text-center py-12 text-admin-text-2">
              <p>아직 수집된 검색어 데이터가 없습니다.</p>
              <p className="text-admin-sm mt-1">Optimization Cron이 실행되면 자동으로 수집됩니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-admin-sm">
                <thead>
                  <tr className="border-b border-admin-border text-admin-text-2">
                    <th className="text-left py-2 px-3">검색어</th>
                    <th className="text-left py-2 px-3">매칭 키워드</th>
                    <th className="text-right py-2 px-3">노출</th>
                    <th className="text-right py-2 px-3">클릭</th>
                    <th className="text-right py-2 px-3">CTR</th>
                    <th className="text-right py-2 px-3">지출</th>
                    <th className="text-center py-2 px-3">첫 발견</th>
                    <th className="text-center py-2 px-3">마지막</th>
                    <th className="text-center py-2 px-3">플랫폼</th>
                  </tr>
                </thead>
                <tbody>
                  {searchTerms.map((st, i) => (
                    <tr key={i} className="border-b border-admin-border hover:bg-admin-surface-2 transition-colors">
                      <td className="py-2 px-3 text-admin-text font-medium">{st.search_term}</td>
                      <td className="py-2 px-3 text-admin-text-2">{st.keyword}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmt(st.impressions)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmt(st.clicks)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmtPct(st.ctr)}</td>
                      <td className="py-2 px-3 text-right text-admin-text-2">{fmtMoney(st.spend)}</td>
                      <td className="py-2 px-3 text-center text-admin-text-2">{st.first_seen?.slice(0, 10)}</td>
                      <td className="py-2 px-3 text-center text-admin-text-2">{st.last_seen?.slice(0, 10)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${PLATFORM_COLORS[st.platform] ?? '#888'}20`, color: PLATFORM_COLORS[st.platform] ?? '#888' }}>
                          {PLATFORM_LABELS[st.platform] ?? st.platform}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, change }: { label: string; value: string; change: string | null }) {
  return (
    <div className="bg-admin-surface rounded-xl border border-admin-border p-4">
      <p className="text-admin-xs text-admin-text-2 mb-1">{label}</p>
      <p className="text-xl font-semibold text-admin-text">{value}</p>
      {change && (
        <p className={`text-admin-xs mt-1 ${change.startsWith('+') ? 'text-success' : 'text-danger'}`}>{change}</p>
      )}
    </div>
  );
}
