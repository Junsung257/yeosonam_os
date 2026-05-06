/**
 * Pairwise 풀 비교 모달 (v3.7, 2026-04-30)
 *
 * 같은 출발일 그룹의 1위 vs 2위(/3위) 패키지를 사이드바이사이드 표로 비교.
 * RecommendationCard의 토글보다 더 풍부 — 표 형태 + 항목별 차이 강조.
 */
'use client';

import { useEffect } from 'react';

interface RivalLite {
  package_id: string;
  title: string;
  rank_in_group: number;
  list_price: number;
  effective_price: number;
  hotel_avg_grade: number | null;
  shopping_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
}

interface SelfLite {
  package_id: string;
  title: string;
  list_price: number;
  hotel_avg_grade: number | null;
  shopping_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
  product_highlights: string[];
}

interface Props {
  self: SelfLite;
  rivals: RivalLite[];
  departureDate: string | null;
  open: boolean;
  onClose: () => void;
}

export default function PairwiseCompareModal({ self, rivals, departureDate, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const all = [
    {
      label: '🥇 이 패키지 (1위)',
      data: {
        title: self.title,
        list_price: self.list_price,
        hotel_avg_grade: self.hotel_avg_grade,
        shopping_count: self.shopping_count,
        free_option_count: self.free_option_count,
        is_direct_flight: self.is_direct_flight,
      },
      isSelf: true,
    },
    ...rivals.map(r => ({
      label: `${r.rank_in_group === 2 ? '🥈' : '🥉'} ${r.rank_in_group}위 옵션`,
      data: r,
      isSelf: false,
    })),
  ];

  // 행 데이터 (헤더, 모든 옵션의 값)
  const rows: { label: string; render: (d: (typeof all)[0]['data']) => React.ReactNode; bestIs?: 'high' | 'low' }[] = [
    {
      label: '정가',
      render: (d) => `₩${d.list_price.toLocaleString()}`,
      bestIs: 'low',
    },
    {
      label: '호텔 등급',
      render: (d) => d.hotel_avg_grade != null ? `${d.hotel_avg_grade}성` : '미확인',
      bestIs: 'high',
    },
    {
      label: '직항',
      render: (d) => d.is_direct_flight ? '✓' : '경유',
      bestIs: 'high',
    },
    {
      label: '쇼핑 횟수',
      render: (d) => d.shopping_count != null ? `${d.shopping_count}회` : '—',
      bestIs: 'low',
    },
    {
      label: '무료 옵션',
      render: (d) => d.free_option_count != null ? `${d.free_option_count}개` : '—',
      bestIs: 'high',
    },
  ];

  // best 컬럼 결정 (각 행마다)
  const bestIdxFor = (rowIdx: number): number | null => {
    const row = rows[rowIdx];
    if (!row.bestIs) return null;
    const values = all.map(a => {
      const d = a.data;
      switch (row.label) {
        case '정가': return d.list_price;
        case '호텔 등급': return d.hotel_avg_grade ?? -1;
        case '직항': return d.is_direct_flight ? 1 : 0;
        case '쇼핑 횟수': return d.shopping_count ?? 99;
        case '무료 옵션': return d.free_option_count ?? -1;
        default: return 0;
      }
    });
    let bestIdx = 0;
    for (let i = 1; i < values.length; i++) {
      if (row.bestIs === 'high' && values[i] > values[bestIdx]) bestIdx = i;
      if (row.bestIs === 'low' && values[i] < values[bestIdx]) bestIdx = i;
    }
    return bestIdx;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">📊 같은 일정 비교</h3>
            {departureDate && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {departureDate.slice(5).replace('-', '/')} 출발 · {all.length}개 옵션
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl px-2" aria-label="닫기">✕</button>
        </div>

        {/* 비교 표 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="border-b border-slate-100">
                <th className="text-left px-3 py-2.5 text-[10px] font-medium text-slate-500 w-20">항목</th>
                {all.map((a, i) => (
                  <th key={i} className={`text-left px-3 py-2.5 text-[11px] font-bold leading-snug ${a.isSelf ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700'}`}>
                    {a.label}
                    <p className="font-normal text-[10px] text-slate-500 mt-0.5 line-clamp-2 break-keep">
                      {a.data.title}
                    </p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const bestIdx = bestIdxFor(ri);
                return (
                  <tr key={ri} className="border-b border-slate-50">
                    <td className="px-3 py-2.5 text-slate-500 font-medium">{row.label}</td>
                    {all.map((a, ai) => (
                      <td key={ai} className={`px-3 py-2.5 tabular-nums ${
                        bestIdx === ai ? 'text-emerald-700 font-bold' : 'text-slate-700'
                      }`}>
                        {row.render(a.data)}
                        {bestIdx === ai && <span className="ml-1 text-[9px] text-emerald-500">★</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 leading-relaxed">
          ★ 표시 = 해당 항목 베스트 · 모든 차이는 같은 출발일 비교 결과
        </div>
      </div>
    </div>
  );
}
