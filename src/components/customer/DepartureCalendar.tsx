'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PriceDate } from '@/lib/price-dates';

interface Props {
  priceDates?: PriceDate[];
  selectedDate?: string;
  onSelect: (date: string) => void;
  /** "YYYY-MM" 초기 표시 월 (생략 시 가장 빠른 출발월 또는 이번 달) */
  initialMonth?: string;
}

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function ymToFirstDate(ym: string): Date {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

function dateToYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dateToYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayYMD(): string {
  return dateToYMD(new Date());
}

export default function DepartureCalendar({ priceDates, selectedDate, onSelect, initialMonth }: Props) {
  const [pastToast, setPastToast] = useState<string | null>(null);

  const dateMap = useMemo(() => {
    const m = new Map<string, PriceDate>();
    (priceDates || []).forEach(d => { if (d?.date) m.set(d.date, d); });
    return m;
  }, [priceDates]);

  const minPrice = useMemo(() => {
    const prices = (priceDates || []).map(d => d.price).filter(p => p > 0);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }, [priceDates]);

  // 초기 월 결정: 인자 > 가장 빠른 출발월 > 이번 달
  const startMonth = useMemo(() => {
    if (initialMonth) return initialMonth;
    const upcoming = [...dateMap.keys()].filter(d => d >= todayYMD()).sort();
    if (upcoming.length > 0) return upcoming[0].slice(0, 7);
    return dateToYM(new Date());
  }, [initialMonth, dateMap]);

  const [viewMonth, setViewMonth] = useState(startMonth);

  const grid = useMemo(() => buildGrid(viewMonth), [viewMonth]);
  const today = todayYMD();

  function shiftMonth(delta: number) {
    const d = ymToFirstDate(viewMonth);
    d.setMonth(d.getMonth() + delta);
    setViewMonth(dateToYM(d));
  }

  const [y, m] = viewMonth.split('-').map(Number);

  // P2 #3 (2026-04-27): 출발 가능 월 chip row.
  // 사장님 화면에서 5월만 보고 6월 출발일 존재 인지 못하는 케이스 방어 — 한눈에 모든 가능 월 노출.
  const availableMonths = useMemo(() => {
    const today = todayYMD();
    const buckets = new Map<string, number>();
    [...dateMap.entries()].forEach(([ymd, pd]) => {
      if (ymd < today) return;
      if (!pd || pd.price <= 0) return;
      const ym = ymd.slice(0, 7);
      buckets.set(ym, (buckets.get(ym) || 0) + 1);
    });
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [dateMap]);

  return (
    <div className="w-full">
      {/* 출발 가능 월 chip row (2개월 이상 출발일이 있을 때만) */}
      {availableMonths.length >= 2 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {availableMonths.map(([ym, count]) => {
            const [yy, mm] = ym.split('-').map(Number);
            const isActive = ym === viewMonth;
            return (
              <button
                key={ym}
                type="button"
                onClick={() => setViewMonth(ym)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                  isActive
                    ? 'bg-[#3182F6] text-white border-[#3182F6] font-bold shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-[#3182F6] hover:bg-[#EBF3FE]'
                }`}
              >
                {mm}월 <span className={isActive ? 'text-white/70' : 'text-gray-400'}>({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 월 네비 */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center transition"
          aria-label="이전 달"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-base font-bold text-gray-900">{y}년 {m}월</div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center transition"
          aria-label="다음 달"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW_LABELS.map((d, i) => (
          <div
            key={d}
            className={`text-xs font-medium text-center py-1 ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell, i) => {
          if (!cell) return <div key={i} className="aspect-square" />;
          const ymd = cell.ymd;
          const pd = dateMap.get(ymd);
          const isAvailable = !!pd;
          const isPast = ymd < today;
          const isSelected = ymd === selectedDate;
          const isLowest = pd && minPrice > 0 && pd.price === minPrice;
          const isConfirmed = pd?.confirmed;
          const dow = cell.dow;

          const baseTextColor = isPast
            ? 'text-gray-300'
            : dow === 0
              ? 'text-red-500'
              : dow === 6
                ? 'text-blue-500'
                : 'text-gray-800';

          let bg = '';
          let border = 'border border-transparent';
          if (isSelected) {
            bg = 'bg-[#3182F6] text-white';
            border = 'border border-[#3182F6]';
          } else if (isAvailable && !isPast) {
            if (isConfirmed) {
              bg = 'bg-emerald-50 hover:bg-emerald-100';
              border = 'border border-emerald-300';
            } else {
              bg = 'bg-[#EBF3FE] hover:bg-[#d6e8fd]';
              border = 'border border-[#3182F6]/30';
            }
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (isPast) {
                  setPastToast(ymd);
                  setTimeout(() => setPastToast(null), 1800);
                } else if (isAvailable) {
                  onSelect(ymd);
                }
              }}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition relative ${bg} ${border} ${!isAvailable || isPast ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className={`text-sm font-semibold ${isSelected ? 'text-white' : baseTextColor}`}>
                {cell.day}
              </span>
              {pd && !isPast && (
                <span className={`text-[9px] leading-tight font-medium ${isSelected ? 'text-white/90' : 'text-gray-600'}`}>
                  {pd.price > 0
                    ? (() => {
                        // P0 #3 (2026-04-27): 반올림 시 579,000 → "58만" 으로 부풀려져 가격 사기 인상.
                        // 항상 floor + 1자리 정밀도. 정수면 소수점 생략.
                        const v = pd.price / 10000;
                        const s = (Math.floor(v * 10) / 10).toFixed(1);
                        return `${s.endsWith('.0') ? s.slice(0, -2) : s}만`;
                      })()
                    : ''}
                </span>
              )}
              {isLowest && !isSelected && !isPast && (
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] font-bold px-1 py-px rounded-full leading-none">
                  최저가
                </span>
              )}
              {isConfirmed && !isSelected && !isPast && (
                <span className="absolute -top-1 -left-1 bg-emerald-500 text-white text-[8px] font-bold px-1 py-px rounded-full leading-none">
                  확정
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-3 mt-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-300 inline-block" /> 출발확정</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#EBF3FE] border border-[#3182F6]/30 inline-block" /> 선택가능</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 inline-block" /> 최저가</span>
      </div>

      {/* 과거 날짜 탭 시 토스트 */}
      {pastToast && (
        <div className="mt-2 text-center text-xs text-gray-400 animate-pulse">
          이미 지난 날짜입니다
        </div>
      )}
    </div>
  );
}

function buildGrid(ym: string): ({ ymd: string; day: number; dow: number } | null)[] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();

  const cells: ({ ymd: string; day: number; dow: number } | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ ymd, day: d, dow: new Date(y, m - 1, d).getDay() });
  }
  // 마지막 주 끝까지 패딩 (선택사항: 깔끔한 그리드)
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
