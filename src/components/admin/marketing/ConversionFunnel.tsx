'use client';

/**
 * 전환 퍼널 (Conversion Funnel)
 *
 * Impression → Click → Page View → Checkout → Booking → Payment Complete
 * 각 단계별 전환율과 손실률을 시각화합니다.
 */

interface FunnelStep {
  label: string;
  count: number;
  rate: number; // 이전 단계 대비 전환율 (%)
}

interface ConversionFunnelProps {
  steps: FunnelStep[];
  loading?: boolean;
}

function FunnelBar({ count, rate, maxCount, index }: { count: number; rate: number; maxCount: number; index: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const colors = [
    'bg-blue-500',
    'bg-cyan-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
  ];

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1">
        <div className="relative h-7 w-full bg-gray-100 rounded overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${colors[index % colors.length]} rounded transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
          <div className="absolute inset-0 flex items-center px-3 text-xs font-medium text-white mix-blend-difference">
            {count.toLocaleString('ko-KR')}
          </div>
        </div>
      </div>
      <div className="w-20 text-right text-xs text-admin-muted-2 tabular-nums">
        {rate.toFixed(1)}%
      </div>
    </div>
  );
}

export default function ConversionFunnel({ steps, loading }: ConversionFunnelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-admin-md border border-admin-border-mid p-4 animate-pulse space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 bg-admin-surface-2 rounded" />
        ))}
      </div>
    );
  }

  const maxCount = Math.max(...steps.map(s => s.count), 1);

  // 전체 전환율 (첫 단계 → 마지막 단계)
  const overallRate = steps.length >= 2 && steps[0].count > 0
    ? (steps[steps.length - 1].count / steps[0].count) * 100
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-admin-sm font-semibold text-admin-text-2">전환 퍼널 (최근 30일)</h3>
        {overallRate > 0 && (
          <span className="text-[11px] text-admin-muted-2">
            전체 전환율 <strong className="text-admin-text-2">{overallRate.toFixed(2)}%</strong>
          </span>
        )}
      </div>
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={step.label} className="space-y-0.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium text-admin-muted">{step.label}</span>
              <span className="text-[10px] text-admin-muted-2 tabular-nums">
                {i > 0 ? `${step.rate.toFixed(1)}% 전환` : ''}
              </span>
            </div>
            <FunnelBar count={step.count} rate={step.rate} maxCount={maxCount} index={i} />
          </div>
        ))}
      </div>
      {steps.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-admin-sm text-admin-muted-2">퍼널 데이터가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
