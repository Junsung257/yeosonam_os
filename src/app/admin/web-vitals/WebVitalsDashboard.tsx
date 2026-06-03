'use client';

import { useEffect, useState } from 'react';

interface MetricStats {
  p75: number;
  goodPct: number;
  count: number;
}

interface WebVitalsResponse {
  stats?: Record<string, MetricStats>;
  error?: string;
}

type Period = 'day' | 'week';

const METRIC_LABELS: Record<string, string> = {
  LCP: 'LCP (최대 콘텐츠 렌더링)',
  CLS: 'CLS (레이아웃 시프트)',
  INP: 'INP (상호작용 응답성)',
  FCP: 'FCP (첫 콘텐츠 렌더링)',
  TTFB: 'TTFB (첫 바이트 도달)',
};

const METRIC_UNITS: Record<string, string> = {
  LCP: 'ms',
  CLS: '',
  INP: 'ms',
  FCP: 'ms',
  TTFB: 'ms',
};

const GOOD_THRESHOLDS: Record<string, number> = {
  LCP: 2500,
  CLS: 0.1,
  INP: 200,
  FCP: 1800,
  TTFB: 800,
};

export default function WebVitalsDashboard() {
  const [stats, setStats] = useState<Record<string, MetricStats> | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/web-vitals?period=${p}`, {
        credentials: 'same-origin',
      });
      const payload = (await response.json().catch(() => null)) as WebVitalsResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? '데이터 로딩 실패');
        setStats({});
        return;
      }
      setStats(payload?.stats ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 로딩 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(period);
  }, [period]);

  const getBarColor = (goodPct: number) => {
    if (goodPct >= 80) return 'bg-green-500';
    if (goodPct >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getRatingBadge = (p75: number, threshold: number, unit: string) => {
    const display = unit ? `${unit === 'ms' ? Math.round(p75) : p75.toFixed(3)}${unit}` : `${p75.toFixed(3)}`;
    if (p75 <= threshold) {
      return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 font-medium">{display} ✓</span>;
    }
    const thresholdPoor = threshold * 2;
    if (p75 <= thresholdPoor) {
      return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700 font-medium">{display} ⚠</span>;
    }
    return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 font-medium">{display} ✗</span>;
  };

  return (
    <div className="space-y-6">
      {/* 기간 선택 */}
      <div className="flex gap-2">
        <button
          onClick={() => setPeriod('day')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            period === 'day' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          오늘
        </button>
        <button
          onClick={() => setPeriod('week')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            period === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          최근 7일
        </button>
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-400">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
          데이터 수집 중...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          {error}
        </div>
      )}

      {stats && Object.keys(stats).length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-1">아직 수집된 데이터가 없습니다</p>
          <p className="text-sm">실제 사용자가 사이트를 방문하면 자동으로 수집됩니다.</p>
        </div>
      )}

      {stats && Object.keys(stats).length > 0 && (
        <>
          {/* 메트릭 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(stats).map(([name, s]) => {
              const threshold = GOOD_THRESHOLDS[name] ?? Infinity;
              const unit = METRIC_UNITS[name] ?? 'ms';
              return (
                <div key={name} className="bg-white rounded-xl border p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{METRIC_LABELS[name] || name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{s.count}개 측정</p>
                    </div>
                    {getRatingBadge(s.p75, threshold, unit)}
                  </div>

                  {/* Good % 바 */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>양호(good) 비율</span>
                      <span className="font-medium">{s.goodPct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${getBarColor(s.goodPct)}`}
                        style={{ width: `${s.goodPct}%` }}
                      />
                    </div>
                  </div>

                  {/* p75 값 */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
                    <span>p75</span>
                    <span className="font-mono font-medium text-gray-700">
                      {unit === 'ms' ? `${Math.round(s.p75)}ms` : s.p75.toFixed(3)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 전체 현황 요약 */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">전체 평가</h3>
            <div className="flex gap-4">
              {Object.entries(stats).map(([name, s]) => (
                <div key={name} className="flex-1 text-center">
                  <div className="text-lg font-bold">{s.goodPct}%</div>
                  <div className="text-xs text-gray-400">{name}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
