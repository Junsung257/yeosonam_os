'use client';

import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useRouter } from 'next/navigation';
import { Search, ArrowUpDown, X } from 'lucide-react';
import { MobileCard } from '@/components/admin/mobile/MobileCard';
import { MobileStatusBadge } from '@/components/admin/mobile/MobileStatusBadge';
import { fmtK } from '@/lib/admin-utils';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  type MobileBookingRow,
  type SortMode,
  SORT_LABELS,
  SORT_CYCLE,
} from './_types';

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const dep = new Date(iso).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((dep - now.getTime()) / (1000 * 60 * 60 * 24));
}

function fmtDepartureBig(iso: string | null): {
  date: string;
  dday: string | null;
  tone: 'hot' | 'warm' | 'normal' | 'past' | 'none';
} {
  if (!iso) return { date: '미정', dday: null, tone: 'none' };
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const date = `${mm}/${dd}`;
  const left = daysUntil(iso);
  if (left == null) return { date, dday: null, tone: 'normal' };
  if (left < 0) return { date, dday: '종료', tone: 'past' };
  if (left === 0) return { date, dday: 'D-day', tone: 'hot' };
  if (left <= 3) return { date, dday: `D-${left}`, tone: 'hot' };
  if (left <= 14) return { date, dday: `D-${left}`, tone: 'warm' };
  return { date, dday: `D-${left}`, tone: 'normal' };
}

const TONE_CLS: Record<string, string> = {
  hot: 'text-rose-600',
  warm: 'text-amber-600',
  normal: 'text-slate-900',
  past: 'text-slate-400',
  none: 'text-slate-400',
};

function PaidProgress({
  paid,
  total,
}: {
  paid: number | null;
  total: number | null;
}) {
  if (!total || total <= 0) return null;
  const ratio = Math.max(0, Math.min(1, (paid ?? 0) / total));
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 tabular-nums">
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '');
}

function matchesQuery(row: MobileBookingRow, q: string): boolean {
  if (!q) return true;
  const needle = normalize(q);
  const haystack = [
    row.customer_name,
    row.booking_no,
    row.package_title,
    row.departure_date, // YYYY-MM-DD 그대로 매칭
    row.departure_date?.replace(/-/g, '/'), // "04/20" 입력 지원
    row.departure_date?.slice(5), // "04-20" 입력 지원
  ];
  return haystack.some(v => normalize(v).includes(needle));
}

export default function BookingsClient({
  initialRows,
  sort,
  tab,
  departureToday,
}: {
  initialRows: MobileBookingRow[];
  sort: SortMode;
  tab: string;
  departureToday: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');

  useRealtimeRefresh({
    table: 'bookings',
    events: ['INSERT', 'UPDATE'],
    onChange: () => router.refresh(),
  });

  const rows = useMemo(
    () => initialRows.filter(r => matchesQuery(r, q.trim())),
    [initialRows, q],
  );

  function cycleSort() {
    const next = SORT_CYCLE[sort];
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('tab', tab);
    if (departureToday) params.set('departure', 'today');
    if (next !== 'recent') params.set('sort', next);
    const qs = params.toString();
    router.replace(`/m/admin/bookings${qs ? '?' + qs : ''}`, { scroll: false });
  }

  return (
    <>
      <div className="px-3 pt-2 pb-1 bg-slate-50 flex items-center gap-2">
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="이름·예약번호·상품·출발일"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
              aria-label="검색 초기화"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={cycleSort}
          className="flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 active:bg-slate-100 whitespace-nowrap"
          aria-label="정렬 변경"
        >
          <ArrowUpDown size={14} />
          {SORT_LABELS[sort]}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-slate-400">
          {q ? '검색 결과가 없습니다.' : '표시할 예약이 없습니다.'}
        </div>
      ) : (
        <Virtuoso
          useWindowScroll
          data={rows}
          itemContent={(_, row) => {
            const dep = fmtDepartureBig(row.departure_date);
            const toneCls = TONE_CLS[dep.tone];
            return (
              <div className="px-3 py-1.5">
                <MobileCard
                  href={`/m/admin/bookings/${row.id}`}
                  badge={<MobileStatusBadge status={row.status} />}
                  title={
                    <span className="text-lg font-bold text-slate-900 leading-tight">
                      {row.customer_name ?? '예약자 미지정'}
                    </span>
                  }
                  subtitle={
                    <span className="text-xs text-slate-500 truncate block">
                      {row.package_title ?? '상품명 없음'}
                    </span>
                  }
                  rightValue={
                    <div className="text-right">
                      <div className={`text-base font-bold tabular-nums ${toneCls}`}>
                        {dep.date}
                      </div>
                      {dep.dday && (
                        <div className={`text-[10px] font-semibold tabular-nums ${toneCls}`}>
                          {dep.dday}
                        </div>
                      )}
                    </div>
                  }
                  meta={
                    <>
                      <span className="tabular-nums">{row.booking_no ?? '—'}</span>
                      {row.total_price != null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{fmtK(row.total_price)}</span>
                        </>
                      )}
                      <span className="ml-auto">
                        <PaidProgress paid={row.paid_amount} total={row.total_price} />
                      </span>
                    </>
                  }
                />
              </div>
            );
          }}
        />
      )}
    </>
  );
}
