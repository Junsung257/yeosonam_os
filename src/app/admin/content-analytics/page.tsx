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

export default function ContentAnalyticsPage() {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'traffic' | 'conversion' | 'revenue' | 'profit'>('traffic');

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
  }, []);

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
        <h1 className="text-[16px] font-semibold text-slate-800">콘텐츠 성과</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">블로그 글별 유입 → 전환 → 매출 어트리뷰션 (First-touch + Last-touch)</p>
      </div>

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
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-[10px] text-slate-400 uppercase">{card.label}</p>
              <p className={`text-[18px] font-bold ${card.color} mt-0.5`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 앵글×목적지 매트릭스 */}
      {matrixDests.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-[13px] font-semibold text-slate-700 mb-3">앵글 × 목적지 전환 매트릭스</h2>
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
            className={`px-3 py-1.5 rounded text-[12px] font-medium transition ${
              sortBy === t.key ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <p className="py-10 text-center text-[13px] text-slate-400">로딩 중...</p>
      ) : sorted.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-slate-400">발행된 블로그 글이 없습니다</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
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
                          className="text-[12px] font-medium text-slate-800 hover:text-indigo-600 line-clamp-1">
                          {row.seo_title || '제목 없음'}
                        </Link>
                        <span className="ml-1.5 rounded bg-gray-50 px-1 py-0.5 text-[9px] text-gray-400">
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
