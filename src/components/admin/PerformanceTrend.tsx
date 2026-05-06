'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const LineChart = dynamic(() => import('recharts').then((m) => ({ default: m.LineChart })), { ssr: false });
const Line = dynamic(() => import('recharts').then((m) => ({ default: m.Line })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then((m) => ({ default: m.Tooltip })), { ssr: false });
const Legend = dynamic(() => import('recharts').then((m) => ({ default: m.Legend })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => ({ default: m.ResponsiveContainer })), { ssr: false });

export type DaysRange = 7 | 30 | 90;

export interface TrendPoint {
  date: string;
  roas_pct?: number;
  blog_count?: number;
  tasks_done?: number;
}

interface PerformanceTrendProps {
  data: TrendPoint[];
  loading?: boolean;
  onDaysChange?: (days: DaysRange) => void;
  days?: DaysRange;
}

const LINES: { key: keyof TrendPoint; label: string; color: string; yAxisId: string }[] = [
  { key: 'roas_pct',    label: 'ROAS (%)',     color: '#6366f1', yAxisId: 'left'  },
  { key: 'blog_count',  label: '블로그 발행',    color: '#10b981', yAxisId: 'right' },
  { key: 'tasks_done',  label: '파이프라인 성공', color: '#f59e0b', yAxisId: 'right' },
];

const RANGE_OPTIONS: { label: string; value: DaysRange }[] = [
  { label: '7일', value: 7 },
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
];

function fmtDate(d: string, days: DaysRange) {
  // 90일 이상은 월-일만, 30일 이하는 월-일
  return days <= 30 ? d.slice(5) : d.slice(5);
}

export default function PerformanceTrend({
  data,
  loading = false,
  onDaysChange,
  days: externalDays,
}: PerformanceTrendProps) {
  const [internalDays, setInternalDays] = useState<DaysRange>(7);
  const activeDays = externalDays ?? internalDays;

  function handleDaysChange(d: DaysRange) {
    setInternalDays(d);
    onDaysChange?.(d);
  }

  if (loading) {
    return <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />;
  }
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
        데이터 없음
      </div>
    );
  }

  const formatted = data.map((d) => ({ ...d, date: fmtDate(d.date, activeDays) }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          채널별 추이
        </p>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleDaysChange(opt.value)}
              className={[
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                activeDays === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            interval={activeDays === 90 ? 6 : activeDays === 30 ? 2 : 0}
          />
          <YAxis yAxisId="left"  orientation="left"  tick={{ fontSize: 11 }} width={40} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={30} />
          <Tooltip formatter={(v: unknown, name: unknown) => [(Number(v) || 0).toLocaleString('ko-KR'), String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {LINES.map((l) => (
            <Line
              key={l.key}
              yAxisId={l.yAxisId}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={2}
              dot={activeDays <= 7}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
