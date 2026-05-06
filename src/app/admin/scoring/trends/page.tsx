/**
 * /admin/scoring/trends — 패키지별 순위 변동 추적 (v3.8, 2026-04-30)
 *
 * v_package_rank_trends 시각화 — 어떤 패키지가 시간 따라 순위 ↑↓했는지.
 * 사장님이 신상품 효과·정책 변경 효과 직관적 파악.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';

const LineChart = nextDynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const Line = nextDynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const XAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = nextDynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });

interface TrendRow {
  package_id: string;
  policy_version: string;
  group_key: string;
  departure_date: string;
  snapshots: number;
  first_seen: string;
  last_seen: string;
  avg_rank: number;
  best_rank: number;
  worst_rank: number;
  avg_group_size: number;
  avg_effective_price: number;
  latest_rank: number | null;
  oldest_rank: number | null;
  title?: string;
}

interface ChartPoint {
  snapshot_date: string;
  rank_in_group: number;
  effective_price: number;
}

export default function ScoringTrendsPage() {
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'climbed' | 'fell' | 'stable' | 'all'>('all');
  const [selectedPkg, setSelectedPkg] = useState<TrendRow | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/scoring/trends')
      .then(r => r.json())
      .then(d => setTrends(d.trends ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 패키지 클릭 시 history 시계열 fetch
  useEffect(() => {
    if (!selectedPkg) { setChart([]); return; }
    setChartLoading(true);
    fetch(`/api/admin/scoring/history?package_id=${selectedPkg.package_id}&departure_date=${selectedPkg.departure_date}`)
      .then(r => r.json())
      .then(d => setChart(d.history ?? []))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [selectedPkg]);

  const climbed = trends.filter(t => t.latest_rank != null && t.oldest_rank != null && t.latest_rank < t.oldest_rank);
  const fell = trends.filter(t => t.latest_rank != null && t.oldest_rank != null && t.latest_rank > t.oldest_rank);
  const stable = trends.filter(t => t.latest_rank != null && t.oldest_rank != null && t.latest_rank === t.oldest_rank);

  const filtered = filter === 'climbed' ? climbed
    : filter === 'fell' ? fell
    : filter === 'stable' ? stable
    : trends;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">📈 순위 변동 추적</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            package_score_history 시계열 — 신상품 효과·정책 변경 효과·랜드사 변경 영향 즉시 검출
          </p>
        </div>
        <Link href="/admin/scoring" className="text-xs text-violet-600 hover:underline">← 정책 편집</Link>
      </div>

      {/* 통계 카드 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="추적 그룹" value={trends.length} />
        <Kpi label="순위 ↑" value={climbed.length} tone="good" />
        <Kpi label="순위 ↓" value={fell.length} tone="warning" />
        <Kpi label="안정" value={stable.length} />
      </section>

      {/* 필터 */}
      <section className="flex gap-2">
        {(['all', 'climbed', 'fell', 'stable'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold transition ${
              filter === f ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>
            {f === 'all' ? '전체' : f === 'climbed' ? '↑ 상승' : f === 'fell' ? '↓ 하락' : '안정'}
          </button>
        ))}
      </section>

      {/* 트렌드 테이블 */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-slate-600">
              <th className="text-left px-3 py-2">패키지 ID</th>
              <th className="text-left px-3 py-2">출발일</th>
              <th className="text-center px-3 py-2">스냅샷</th>
              <th className="text-center px-3 py-2">순위 변동</th>
              <th className="text-right px-3 py-2">평균 순위</th>
              <th className="text-right px-3 py-2">평균 실효가</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">로딩중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">
                추적 데이터 없음. 매일 04:30 UTC 재계산이 한 번 이상 돌아야 변동 검출 가능.
              </td></tr>
            ) : filtered.slice(0, 50).map((t, i) => {
              const climbed = t.latest_rank != null && t.oldest_rank != null && t.latest_rank < t.oldest_rank;
              const fell = t.latest_rank != null && t.oldest_rank != null && t.latest_rank > t.oldest_rank;
              const isSelected = selectedPkg?.package_id === t.package_id && selectedPkg?.departure_date === t.departure_date;
              return (
                <tr
                  key={i}
                  onClick={() => setSelectedPkg(isSelected ? null : t)}
                  className={`border-b border-slate-100 cursor-pointer transition ${isSelected ? 'bg-violet-50' : 'hover:bg-slate-50/50'}`}
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 truncate max-w-[120px]" title={t.package_id}>
                    {isSelected && '▸ '}{t.package_id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{t.departure_date}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{t.snapshots}회</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                      climbed ? 'text-emerald-700' : fell ? 'text-rose-700' : 'text-slate-500'
                    }`}>
                      {t.oldest_rank} → {t.latest_rank}
                      {climbed && '↑'}
                      {fell && '↓'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{Number(t.avg_rank).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    ₩{Math.round(Number(t.avg_effective_price) / 10000)}만
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* 선택된 패키지 시계열 차트 */}
      {selectedPkg && (
        <section className="bg-white border border-violet-200 rounded-xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                📊 시계열 차트 — {selectedPkg.title || selectedPkg.package_id.slice(0, 8)}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedPkg.departure_date} 출발 · 그룹 사이즈 {Number(selectedPkg.avg_group_size).toFixed(0)}
              </p>
            </div>
            <button onClick={() => setSelectedPkg(null)} className="text-xs text-slate-400 hover:text-slate-700">✕ 닫기</button>
          </div>

          {chartLoading ? (
            <p className="text-center py-8 text-slate-400">로딩중...</p>
          ) : chart.length < 2 ? (
            <p className="text-center py-8 text-slate-400 text-sm">스냅샷 2개 이상 필요</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <XAxis dataKey="snapshot_date" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="rank"
                    reversed
                    domain={[1, 'dataMax']}
                    tick={{ fontSize: 11 }}
                    label={{ value: '순위', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${Math.round(v / 10000)}만`}
                    label={{ value: '실효가', angle: 90, position: 'insideRight', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v, name) => name === '실효가'
                      ? [`₩${Number(v).toLocaleString()}`, '실효가']
                      : [v, '순위']
                    }
                  />
                  <Line yAxisId="rank" type="monotone" dataKey="rank_in_group" stroke="#8b5cf6" strokeWidth={2} name="순위" dot={{ r: 4 }} />
                  <Line yAxisId="price" type="monotone" dataKey="effective_price" stroke="#10b981" strokeWidth={2} name="실효가" dot={{ r: 4 }} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-[10px] text-slate-400 mt-3">
            ※ 보라 = 순위 (낮을수록 좋음, Y축 반전) · 초록 점선 = 실효가
          </p>
        </section>
      )}

      <p className="text-[10px] text-slate-400">
        ※ v_package_rank_trends 기반 · 매일 04:30 UTC 자동 갱신 · 최대 50행 · 행 클릭 시 시계열 차트
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warning' }) {
  const cls = tone === 'good' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : tone === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-slate-50 text-slate-800 border-slate-200';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums mt-1">{value}</div>
    </div>
  );
}
