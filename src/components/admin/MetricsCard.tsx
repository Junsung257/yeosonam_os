'use client';

type Trend = 'up' | 'down' | 'neutral';

interface MetricsCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  trend?: Trend;
  sublabel?: string;
  loading?: boolean;
}

function getTrendDir(trend?: Trend, delta?: number): Trend {
  return trend ?? (delta !== undefined ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral') : 'neutral');
}

function trendColor(trend?: Trend, delta?: number): string {
  const dir = getTrendDir(trend, delta);
  if (dir === 'up') return 'text-emerald-600';
  if (dir === 'down') return 'text-red-500';
  return 'text-slate-400';
}

function trendArrow(trend?: Trend, delta?: number): string {
  const dir = getTrendDir(trend, delta);
  if (dir === 'up') return '▲';
  if (dir === 'down') return '▼';
  return '—';
}

export default function MetricsCard({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  trend,
  sublabel,
  loading = false,
}: MetricsCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="h-3 w-24 bg-slate-200 rounded mb-3" />
        <div className="h-7 w-20 bg-slate-200 rounded mb-2" />
        <div className="h-3 w-16 bg-slate-100 rounded" />
      </div>
    );
  }

  const color = trendColor(trend, delta);
  const arrow = trendArrow(trend, delta);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-800">
          {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
        </span>
        {unit && <span className="text-sm text-slate-500">{unit}</span>}
      </div>
      {(delta !== undefined || sublabel) && (
        <div className="flex items-center gap-1.5 text-xs">
          {delta !== undefined && (
            <span className={`font-semibold ${color}`}>
              {arrow} {Math.abs(delta)}%
            </span>
          )}
          {deltaLabel && <span className="text-slate-400">{deltaLabel}</span>}
          {sublabel && !deltaLabel && <span className="text-slate-400">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
