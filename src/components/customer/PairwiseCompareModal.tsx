'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

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

type CompareItem = {
  title: string;
  list_price: number;
  hotel_avg_grade: number | null;
  shopping_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
};

function formatKrw(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '상담 후 확인';
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function formatHotelCondition(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '상담 후 확인';
  if (value >= 4.5) return '호텔 조건 우수';
  if (value >= 3.5) return '호텔 조건 확인';
  return '상담 후 확인';
}

function formatCount(value: number | null, suffix: string): string {
  if (value == null || !Number.isFinite(value)) return '상담 후 확인';
  return `${value}${suffix}`;
}

export default function PairwiseCompareModal({ self, rivals, departureDate, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const items: Array<{ label: string; data: CompareItem; isSelf: boolean }> = [
    {
      label: '선택한 상품',
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
    ...rivals.map((rival) => ({
      label: `${rival.rank_in_group}순위 일정`,
      data: rival,
      isSelf: false,
    })),
  ];

  const rows: Array<{
    label: string;
    render: (item: CompareItem) => ReactNode;
    value: (item: CompareItem) => number;
    bestIs: 'high' | 'low';
  }> = [
    {
      label: '가격',
      render: (item) => formatKrw(item.list_price),
      value: (item) => (Number.isFinite(item.list_price) && item.list_price > 0 ? item.list_price : Number.MAX_SAFE_INTEGER),
      bestIs: 'low',
    },
    {
      label: '호텔 조건',
      render: (item) => formatHotelCondition(item.hotel_avg_grade),
      value: (item) => item.hotel_avg_grade ?? -1,
      bestIs: 'high',
    },
    {
      label: '항공',
      render: (item) => (item.is_direct_flight ? '직항' : '경유 또는 상담 확인'),
      value: (item) => (item.is_direct_flight ? 1 : 0),
      bestIs: 'high',
    },
    {
      label: '쇼핑',
      render: (item) => formatCount(item.shopping_count, '회'),
      value: (item) => item.shopping_count ?? Number.MAX_SAFE_INTEGER,
      bestIs: 'low',
    },
    {
      label: '포함 옵션',
      render: (item) => formatCount(item.free_option_count, '개'),
      value: (item) => item.free_option_count ?? -1,
      bestIs: 'high',
    },
  ];

  const bestIdxFor = (rowIndex: number): number | null => {
    const row = rows[rowIndex];
    const values = items.map((item) => row.value(item.data));
    let bestIdx = 0;

    for (let i = 1; i < values.length; i += 1) {
      if (row.bestIs === 'high' && values[i] > values[bestIdx]) bestIdx = i;
      if (row.bestIs === 'low' && values[i] < values[bestIdx]) bestIdx = i;
    }

    return Number.isFinite(values[bestIdx]) ? bestIdx : null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label="비교 창 닫기"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white md:max-w-2xl md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold text-slate-900">같은 출발일 상품 비교</h3>
            {departureDate && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                {departureDate.slice(5).replace('-', '/')} 출발 · {items.length}개 일정
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 text-xl text-slate-400 hover:text-slate-600"
            aria-label="비교 창 닫기"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-100">
                <th className="w-20 px-3 py-2.5 text-left text-[10px] font-medium text-slate-500">항목</th>
                {items.map((item) => (
                  <th
                    key={item.label}
                    className={`px-3 py-2.5 text-left text-[11px] font-bold leading-snug ${
                      item.isSelf ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700'
                    }`}
                  >
                    {item.label}
                    <p className="mt-0.5 line-clamp-2 break-keep text-[10px] font-normal text-slate-500">
                      {item.data.title}
                    </p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const bestIdx = bestIdxFor(rowIndex);
                return (
                  <tr key={row.label} className="border-b border-slate-50">
                    <td className="px-3 py-2.5 font-medium text-slate-500">{row.label}</td>
                    {items.map((item, itemIndex) => (
                      <td
                        key={`${row.label}-${item.label}`}
                        className={`px-3 py-2.5 tabular-nums ${
                          bestIdx === itemIndex ? 'font-bold text-emerald-700' : 'text-slate-700'
                        }`}
                      >
                        {row.render(item.data)}
                        {bestIdx === itemIndex && <span className="ml-1 text-[9px] text-emerald-500">추천</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
          비교 결과는 현재 저장된 상품 조건 기준입니다. 실제 가능 여부와 요금은 상담 시점에 다시 확인합니다.
        </div>
      </div>
    </div>
  );
}
