'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const LineChart = dynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const ComposedChart = dynamic(() => import('recharts').then(m => ({ default: m.ComposedChart })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const Legend = dynamic(() => import('recharts').then(m => ({ default: m.Legend })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });

/**
 * 통합 트렌드 차트 — 채널별 Spend + Revenue 이중 축
 *
 * X축: 날짜 (일별/주별/월별 토글)
 * Y축(좌): Spend (막대), Y축(우): Revenue (라인)
 * 채널별로 다른 색상 사용
 */

type Granularity = 'daily' | 'weekly' | 'monthly';

interface TrendDataPoint {
  date: string;
  google_spend: number;
  google_revenue: number;
  naver_spend: number;
  naver_revenue: number;
  meta_spend: number;
  meta_revenue: number;
  organic_revenue: number;
}

interface BlendedTrendChartProps {
  data: TrendDataPoint[];
  loading?: boolean;
}

function formatWon(v: number): string {
  if (v >= 1_000_000) return `${(v / 10000).toFixed(0)}만`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}천`;
  return v.toLocaleString('ko-KR');
}

const CHANNEL_CONFIG = {
  google: { spendColor: '#3b82f6', revenueColor: '#93c5fd', label: 'Google' },
  naver: { spendColor: '#10b981', revenueColor: '#6ee7b7', label: 'Naver' },
  meta: { spendColor: '#6366f1', revenueColor: '#a5b4fc', label: 'Meta' },
};

export default function BlendedTrendChart({ data, loading }: BlendedTrendChartProps) {
  const [granularity, setGranularity] = useState<Granularity>('daily');

  const chartData = useMemo(() => {
    return data.map(d => ({
      ...d,
      // 합계
      total_spend: (d.google_spend ?? 0) + (d.naver_spend ?? 0) + (d.meta_spend ?? 0),
      total_revenue: (d.google_revenue ?? 0) + (d.naver_revenue ?? 0) + (d.meta_revenue ?? 0) + (d.organic_revenue ?? 0),
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white rounded-admin-md border border-admin-border-mid p-4 animate-pulse">
        <div className="h-48 bg-admin-surface-2 rounded" />
      </div>
    );
  }

  return (
    <div>
      {/* 상단: 타이틀 + Granularity 토글 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-admin-sm font-semibold text-admin-text-2">통합 트렌드</h3>
        <div className="flex gap-1 bg-admin-surface-2 rounded-md p-0.5">
          {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded ${
                granularity === g
                  ? 'bg-white text-admin-text-2 shadow-sm border border-admin-border-mid'
                  : 'text-admin-muted hover:text-admin-text-2'
              }`}
            >
              {g === 'daily' ? '일별' : g === 'weekly' ? '주별' : '월별'}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <p className="text-admin-sm font-medium text-admin-muted">트렌드 데이터가 없습니다.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => {
                if (granularity === 'monthly') return v.slice(5);
                return v.slice(5, 10);
              }}
            />
            <YAxis
              yAxisId="spend"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => formatWon(v)}
            />
            <YAxis
              yAxisId="revenue"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => formatWon(v)}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => {
                const numVal = typeof value === 'number' ? value : 0;
                const label =
                  name === 'google_spend' ? 'Google 광고비' :
                  name === 'naver_spend' ? 'Naver 광고비' :
                  name === 'meta_spend' ? 'Meta 광고비' :
                  name === 'google_revenue' ? 'Google 매출' :
                  name === 'naver_revenue' ? 'Naver 매출' :
                  name === 'meta_revenue' ? 'Meta 매출' :
                  name === 'organic_revenue' ? '오가닉 매출' :
                  name === 'total_spend' ? '총 광고비' :
                  name === 'total_revenue' ? '총 매출' :
                  String(name);
                return [`${formatWon(numVal)}원`, label];
              }}
              labelFormatter={(label: unknown) => String(label)}
            />
            <Legend
              formatter={(value: unknown) => {
                const v = String(value);
                return (
                  v === 'google_spend' ? 'Google 광고비' :
                  v === 'naver_spend' ? 'Naver 광고비' :
                  v === 'meta_spend' ? 'Meta 광고비' :
                  v === 'google_revenue' ? 'Google 매출' :
                  v === 'naver_revenue' ? 'Naver 매출' :
                  v === 'meta_revenue' ? 'Meta 매출' :
                  v === 'organic_revenue' ? '오가닉 매출' :
                  v === 'total_spend' ? '총 광고비' :
                  v === 'total_revenue' ? '총 매출' : v
                );
              }}
            />
            {/* Spend 막대 (channel별) */}
            <Bar yAxisId="spend" dataKey="total_spend" fill="#94a3b8" opacity={0.3} barSize={20} name="total_spend" />
            {/* Revenue 라인 */}
            <Line yAxisId="revenue" type="monotone" dataKey="google_revenue" stroke={CHANNEL_CONFIG.google.revenueColor} strokeWidth={1.5} dot={false} name="google_revenue" />
            <Line yAxisId="revenue" type="monotone" dataKey="naver_revenue" stroke={CHANNEL_CONFIG.naver.revenueColor} strokeWidth={1.5} dot={false} name="naver_revenue" />
            <Line yAxisId="revenue" type="monotone" dataKey="meta_revenue" stroke={CHANNEL_CONFIG.meta.revenueColor} strokeWidth={1.5} dot={false} name="meta_revenue" />
            <Line yAxisId="revenue" type="monotone" dataKey="organic_revenue" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="organic_revenue" />
            <Line yAxisId="revenue" type="monotone" dataKey="total_revenue" stroke="#1e293b" strokeWidth={2} dot={{ r: 2 }} name="total_revenue" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
