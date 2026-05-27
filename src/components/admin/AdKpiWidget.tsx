'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';

const LineChart = dynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });

interface DailyRow {
  date: string;
  platform: string;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
  conversions: number;
  keyword_count: number;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '₩0';
  if (n >= 1_000_000) return `₩${(n / 10_000).toFixed(0)}만`;
  if (n >= 1_000) return `₩${(n / 1_000).toFixed(0)}천`;
  return `₩${n.toLocaleString('ko-KR')}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

export default function AdKpiWidget() {
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) {
          setError('Supabase not configured');
          setLoading(false);
          return;
        }
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 최근 30일 데이터 조회
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data, error: dbError } = await supabase
          .from('keyword_performance_daily')
          .select('*')
          .gte('date', thirtyDaysAgo.toISOString().slice(0, 10))
          .order('date', { ascending: true });

        if (dbError) {
          setError(dbError.message);
        } else {
          setDaily((data ?? []) as DailyRow[]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="bg-admin-surface rounded-xl border border-admin-border p-4">
        <div className="h-5 w-24 bg-admin-surface-2 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-admin-surface-2 rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error || daily.length === 0) return null;

  // KPI 계산
  const todayTotal = daily.filter(d => d.date === daily[daily.length - 1]?.date);
  const todaySpend = todayTotal.reduce((s, d) => s + d.spend, 0);
  const todayClicks = todayTotal.reduce((s, d) => s + d.clicks, 0);
  const todayImpressions = todayTotal.reduce((s, d) => s + d.impressions, 0);
  const todayCtr = todayImpressions > 0 ? todayClicks / todayImpressions : 0;
  const todayCpc = todayClicks > 0 ? todaySpend / todayClicks : 0;

  const last7 = daily.slice(-7);
  const weekSpend = last7.reduce((s, d) => s + d.spend, 0);
  const weekClicks = last7.reduce((s, d) => s + d.clicks, 0);

  const monthSpend = daily.reduce((s, d) => s + d.spend, 0);
  const monthClicks = daily.reduce((s, d) => s + d.clicks, 0);

  // 일별 집계 차트 데이터
  const aggregated = daily.reduce<Record<string, { spend: number; clicks: number; impressions: number }>>((acc, row) => {
    if (!acc[row.date]) acc[row.date] = { spend: 0, clicks: 0, impressions: 0 };
    acc[row.date].spend += row.spend;
    acc[row.date].clicks += row.clicks;
    acc[row.date].impressions += row.impressions;
    return acc;
  }, {});

  const chartData = Object.entries(aggregated).map(([date, val]) => ({
    date: date.slice(5), // MM-DD
    spend: val.spend,
    clicks: val.clicks,
  }));

  return (
    <div className="bg-admin-surface rounded-xl border border-admin-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-admin-sm font-medium text-admin-text">검색광고 성과</h3>
      </div>

      {/* 오늘 KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-admin-surface-2 rounded-lg p-3">
          <p className="text-admin-xs text-admin-text-2">오늘 지출</p>
          <p className="text-lg font-semibold text-admin-text">{fmtMoney(todaySpend)}</p>
        </div>
        <div className="bg-admin-surface-2 rounded-lg p-3">
          <p className="text-admin-xs text-admin-text-2">오늘 클릭</p>
          <p className="text-lg font-semibold text-admin-text">{todayClicks.toLocaleString('ko-KR')}</p>
        </div>
        <div className="bg-admin-surface-2 rounded-lg p-3">
          <p className="text-admin-xs text-admin-text-2">CTR</p>
          <p className="text-lg font-semibold text-admin-text">{fmtPct(todayCtr)}</p>
        </div>
        <div className="bg-admin-surface-2 rounded-lg p-3">
          <p className="text-admin-xs text-admin-text-2">CPC</p>
          <p className="text-lg font-semibold text-admin-text">{fmtMoney(todayCpc)}</p>
        </div>
      </div>

      {/* 주간/월간 */}
      <div className="flex gap-4 mb-4 text-admin-xs text-admin-text-2">
        <span>주간 지출: <strong className="text-admin-text">{fmtMoney(weekSpend)}</strong></span>
        <span>주간 클릭: <strong className="text-admin-text">{weekClicks.toLocaleString('ko-KR')}</strong></span>
        <span>월간 지출: <strong className="text-admin-text">{fmtMoney(monthSpend)}</strong></span>
        <span>월간 클릭: <strong className="text-admin-text">{monthClicks.toLocaleString('ko-KR')}</strong></span>
      </div>

      {/* 일간 추세 차트 */}
      {chartData.length > 0 && (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="spend" stroke="#4285F4" strokeWidth={2} dot={false} name="지출" />
              <Line type="monotone" dataKey="clicks" stroke="#03C75A" strokeWidth={2} dot={false} name="클릭" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
