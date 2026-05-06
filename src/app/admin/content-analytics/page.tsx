'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리',
  urgency: '긴급특가', activity: '액티비티', food: '미식',
};

interface ContentRow {
  creative_id: string;
  slug: string;
  seo_title: string | null;
  angle_type: string;
  product_id: string | null;
  package_title: string | null;
  destination: string | null;
  published_at: string | null;
  traffic_count: number;
  first_touch_conversions: number;
  first_touch_revenue: number;
  first_touch_cost: number;
  first_touch_profit: number;
  last_touch_conversions: number;
  last_touch_revenue: number;
}

interface KPI {
  total_published: number;
  total_traffic: number;
  total_first_touch_conversions: number;
  total_revenue: number;
  total_profit: number;
  avg_conversion_rate: string;
}

interface LearningStatus {
  ready: boolean;
  stats: { published_blogs: number; total_engagement: number };
  thresholds: { min_posts: number; min_engagement: number };
  progress: { posts_pct: number; engagement_pct: number };
}

export default function ContentAnalyticsPage() {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'traffic' | 'conversion' | 'revenue' | 'profit'>('traffic');
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    fetch('/api/content-analytics?limit=100')
      .then(r => r.json())
      .then(d => {
        setRows(d.analytics || []);
        setKpi(d.kpi || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // 학습 엔진 상태 조회
    fetch('/api/agent/prompt-optimizer')
      .then(r => r.json())
      .then(d => setLearningStatus(d))
      .catch(() => {});
  }, []);

  const runOptimizer = async () => {
    setOptimizing(true);
    setOptimizeResult('');
    try {
      const res = await fetch('/api/agent/prompt-optimizer', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'suggestion_created') {
        setOptimizeResult(`✓ 제안이 결재함에 등록되었습니다. (/admin/jarvis?tab=actions)`);
      } else if (data.status === 'insufficient_data' || data.status === 'insufficient_engagement') {
        setOptimizeResult(`⚠ ${data.message}`);
      } else {
        setOptimizeResult(`에러: ${data.error || '알 수 없음'}`);
      }
    } catch (err: any) {
      setOptimizeResult(`에러: ${err.message}`);
    } finally {
      setOptimizing(false);
    }
  };

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'traffic') return b.traffic_count - a.traffic_count;
    if (sortBy === 'conversion') return b.first_touch_conversions - a.first_touch_conversions;
    if (sortBy === 'revenue') return b.first_touch_revenue - a.first_touch_revenue;
    return b.first_touch_profit - a.first_touch_profit;
  });

  const fmtKRW = (n: number) => n ? `${(n / 10000).toFixed(0)}만` : '-';

  // 앵글×목적지 매트릭스 집계
  const angleKeys = ['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food'] as const;
  const matrix = new Map<string, Map<string, { traffic: number; conversions: number }>>();
  for (const row of rows) {
    const dest = row.destination || '기타';
    if (!matrix.has(dest)) matrix.set(dest, new Map());
    const destMap = matrix.get(dest)!;
    const angle = row.angle_type;
    const prev = destMap.get(angle) || { traffic: 0, conversions: 0 };
    destMap.set(angle, {
      traffic: prev.traffic + row.traffic_count,
      conversions: prev.conversions + row.first_touch_conversions,
    });
  }
  const matrixDests = [...matrix.keys()].sort();

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div>
        <h1 className="text-admin-lg font-semibold text-slate-800">콘텐츠 성과</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">블로그 글별 유입 → 전환 → 매출 어트리뷰션 (First-touch + Last-touch)</p>
      </div>

      {/* 자가학습 엔진 상태 */}
      {learningStatus && (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-admin-sm font-semibold text-indigo-900 flex items-center gap-1.5">
                🧠 자비스 블로그 학습 엔진
                {learningStatus.ready ? (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">학습 가능</span>
                ) : (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">데이터 수집 중</span>
                )}
              </h2>
              <p className="text-[11px] text-slate-600 mt-0.5">
                상위 vs 하위 성과 글 비교 분석 → 프롬프트 개선안 자동 제안 (결재함에 등록)
              </p>
            </div>
            <button
              onClick={runOptimizer}
              disabled={!learningStatus.ready || optimizing}
              className="px-3 py-1.5 bg-blue-600 text-white text-admin-xs font-medium rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title={learningStatus.ready ? '학습 실행' : '데이터가 더 필요합니다'}
            >
              {optimizing ? '분석 중...' : '학습 실행'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500">발행된 블로그</span>
                <span className="text-[11px] font-semibold tabular-nums">{learningStatus.stats.published_blogs} / {learningStatus.thresholds.min_posts}</span>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${learningStatus.progress.posts_pct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500">Engagement 로그</span>
                <span className="text-[11px] font-semibold tabular-nums">{learningStatus.stats.total_engagement} / {learningStatus.thresholds.min_engagement}</span>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${learningStatus.progress.engagement_pct}%` }} />
              </div>
            </div>
          </div>
          {optimizeResult && (
            <div className="mt-3 px-2.5 py-2 bg-white/80 rounded text-[11px] text-slate-700 border border-slate-200">
              {optimizeResult}
            </div>
          )}
        </div>
      )}

      {/* KPI 카드 */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: '발행 글', value: `${kpi.total_published}편`, color: 'text-slate-800' },
            { label: '총 유입', value: `${kpi.total_traffic.toLocaleString()}회`, color: 'text-blue-600' },
            { label: 'First-touch 전환', value: `${kpi.total_first_touch_conversions}건`, color: 'text-green-600' },
            { label: '전환율', value: `${kpi.avg_conversion_rate}%`, color: 'text-orange-600' },
            { label: '매출', value: fmtKRW(kpi.total_revenue), color: 'text-indigo-600' },
            { label: '순이익', value: fmtKRW(kpi.total_profit), color: kpi.total_profit > 0 ? 'text-green-600' : 'text-red-500' },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
              <p className="text-[10px] text-slate-400 uppercase">{card.label}</p>
              <p className={`text-[18px] font-bold ${card.color} mt-0.5`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 앵글×목적지 매트릭스 */}
      {matrixDests.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <h2 className="text-admin-sm font-semibold text-slate-700 mb-3">앵글 × 목적지 전환 매트릭스</h2>
          <div className="overflow-x-auto">
            <table className="text-[11px] w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-2 py-1.5 text-left text-slate-500 font-medium">목적지</th>
                  {angleKeys.map(a => (
                    <th key={a} className="px-2 py-1.5 text-center text-slate-500 font-medium">{ANGLE_LABELS[a]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrixDests.map(dest => (
                  <tr key={dest} className="hover:bg-slate-50">
                    <td className="px-2 py-1.5 font-medium text-slate-700">{dest}</td>
                    {angleKeys.map(a => {
                      const cell = matrix.get(dest)?.get(a);
                      if (!cell || cell.traffic === 0) return <td key={a} className="px-2 py-1.5 text-center text-slate-200">-</td>;
                      const cvr = ((cell.conversions / cell.traffic) * 100).toFixed(1);
                      return (
                        <td key={a} className={`px-2 py-1.5 text-center font-medium ${
                          cell.conversions > 0 ? 'text-green-600' : 'text-slate-500'
                        }`}>
                          {cvr}%
                          <span className="block text-[9px] text-slate-400">{cell.traffic}유입</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-slate-400 mt-2">셀 = First-touch 전환율 (유입 → 예약). 높은 전환율 앵글 우선 생산 권장</p>
        </div>
      )}

      {/* 정렬 탭 */}
      <div className="flex gap-1">
        {([
          { key: 'traffic' as const, label: '유입순' },
          { key: 'conversion' as const, label: '전환순' },
          { key: 'revenue' as const, label: '매출순' },
          { key: 'profit' as const, label: '순이익순' },
        ]).map(t => (
          <button key={t.key} onClick={() => setSortBy(t.key)}
            className={`px-3 py-1.5 rounded text-admin-xs font-medium transition ${
              sortBy === t.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden divide-y divide-slate-50">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-16" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-16" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14">
          <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
          <p className="text-admin-sm font-medium text-slate-500">발행된 블로그 글이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                <th className="px-3 py-2.5 font-medium">글</th>
                <th className="px-3 py-2.5 font-medium">목적지</th>
                <th className="px-3 py-2.5 font-medium text-right">유입</th>
                <th className="px-3 py-2.5 font-medium text-right">
                  <span title="First-touch: 이 글이 최초 유입 경로였던 전환">FT 전환</span>
                </th>
                <th className="px-3 py-2.5 font-medium text-right">
                  <span title="Last-touch: 이 글이 마지막 접점이었던 전환">LT 전환</span>
                </th>
                <th className="px-3 py-2.5 font-medium text-right">FT 매출</th>
                <th className="px-3 py-2.5 font-medium text-right">FT 순이익</th>
                <th className="px-3 py-2.5 font-medium text-right">전환율</th>
                <th className="px-3 py-2.5 font-medium">발행일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(row => {
                const cvr = row.traffic_count > 0
                  ? ((row.first_touch_conversions / row.traffic_count) * 100).toFixed(1)
                  : '-';

                return (
                  <tr key={row.creative_id} className="hover:bg-slate-50 transition">
                    <td className="px-3 py-2.5">
                      <div className="max-w-xs">
                        <Link href={`/blog/${row.slug}`} target="_blank"
                          className="text-admin-xs font-medium text-slate-800 hover:text-indigo-600 line-clamp-1">
                          {row.seo_title || '제목 없음'}
                        </Link>
                        <span className="ml-1.5 rounded bg-slate-50 px-1 py-0.5 text-[9px] text-slate-400">
                          {ANGLE_LABELS[row.angle_type] || row.angle_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{row.destination || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-blue-600">
                      {row.traffic_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-green-600">
                      {row.first_touch_conversions || '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-500">
                      {row.last_touch_conversions || '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-indigo-600">
                      {row.first_touch_revenue ? fmtKRW(row.first_touch_revenue) : '-'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${row.first_touch_profit > 0 ? 'text-green-600' : row.first_touch_profit < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {row.first_touch_profit ? fmtKRW(row.first_touch_profit) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-500">
                      {cvr === '-' ? '-' : `${cvr}%`}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {row.published_at ? new Date(row.published_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 범례 */}
      <div className="text-[10px] text-slate-400 space-y-0.5">
        <p><strong>FT (First-touch)</strong>: 고객이 처음 유입된 콘텐츠 기준 전환 귀속</p>
        <p><strong>LT (Last-touch)</strong>: 전환 직전 마지막으로 접촉한 콘텐츠 기준 귀속</p>
        <p>데이터는 블로그 글을 통해 유입 → 예약 전환된 세션만 집계합니다</p>
      </div>
    </div>
  );
}
