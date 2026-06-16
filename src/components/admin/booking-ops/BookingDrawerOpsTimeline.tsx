'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  BookingOpsTimelineItem,
  BookingOpsTimelineResponse,
  BookingOpsTimelineTone,
} from '@/lib/booking-ops-timeline';

interface BookingDrawerOpsTimelineProps {
  bookingId: string;
}

const toneClass: Record<BookingOpsTimelineTone, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-800',
  purple: 'border-purple-200 bg-purple-50 text-purple-800',
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function BookingDrawerOpsTimeline({ bookingId }: BookingDrawerOpsTimelineProps) {
  const [items, setItems] = useState<BookingOpsTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ booking_id: bookingId });
      const res = await fetch(`/api/admin/booking-ops/timeline?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as BookingOpsTimelineResponse;
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = expanded ? items : items.slice(0, 5);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-extrabold text-slate-900">운영 타임라인</h3>
          <p className="text-[11px] text-slate-500">예약·입금·액션큐·메시지 흐름</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          새로고침
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-[12px] text-slate-500">
          아직 표시할 운영 이벤트가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <TimelineItem key={item.id} item={item} />
          ))}
          {items.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              {expanded ? '접기' : `${items.length - 5}건 더 보기`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TimelineItem({ item }: { item: BookingOpsTimelineItem }) {
  const content = (
    <div className={`rounded-md border px-3 py-2 ${toneClass[item.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[12px] font-extrabold">{item.title}</p>
        <time className="shrink-0 text-[10px] font-bold opacity-70">{formatDateTime(item.at)}</time>
      </div>
      {item.detail && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed opacity-80">{item.detail}</p>
      )}
    </div>
  );

  if (!item.href) return content;
  return (
    <Link href={item.href} className="block">
      {content}
    </Link>
  );
}
