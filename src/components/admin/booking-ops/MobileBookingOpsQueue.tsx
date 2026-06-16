'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookingTaskActionCard } from './BookingTaskActionCard';
import type { BookingOpsAction, BookingOpsSummary } from '@/lib/booking-ops';

export function MobileBookingOpsQueue() {
  const [summary, setSummary] = useState<BookingOpsSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/booking-ops/summary?limit=5', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setSummary((await res.json()) as BookingOpsSummary);
    } catch {
      setSummary(null);
      setError('예약 액션큐를 확인하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeAction = useCallback((action: BookingOpsAction) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    setSummary((prev) => prev
      ? {
        ...prev,
        actions: prev.actions.filter((item) => !taskIds.includes(item.id)),
      }
      : prev,
    );
  }, []);

  const resolve = useCallback(async (action: BookingOpsAction) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    removeAction(action);
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: action.recommendedAction }),
      }),
    ));
    if (results.some((res) => !res.ok)) await load();
  }, [load, removeAction]);

  const snooze = useCallback(async (action: BookingOpsAction, hours: number) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    setSnoozeFor(null);
    removeAction(action);
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours }),
      }),
    ));
    if (results.some((res) => !res.ok)) await load();
  }, [load, removeAction]);

  const actions = summary?.actions ?? [];
  const visible = expanded ? actions : actions.slice(0, 2);
  const urgent = summary?.metrics.urgentOpen ?? 0;
  const today = summary?.metrics.todayOpen ?? 0;
  const bank = (summary?.metrics.unmatchedBank ?? 0) + (summary?.metrics.bankReview ?? 0);

  return (
    <section className="bg-admin-bg px-3 py-2">
      <div className="rounded-admin-md border border-admin-border bg-white p-3 shadow-admin-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-admin-text">오늘 처리</h2>
            <p className="text-[11px] text-admin-muted">
              긴급 {urgent} · 오늘 {today} · 입금대기 {bank}
            </p>
          </div>
          {actions.length > 2 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-admin-sm border border-admin-border-mid px-2 py-1 text-[11px] font-semibold text-admin-text-2 active:bg-admin-surface-2"
            >
              {expanded ? '접기' : `${actions.length}건 보기`}
            </button>
          )}
        </div>

        {loading && !summary ? (
          <div className="space-y-2">
            <div className="h-12 animate-pulse rounded-admin-sm bg-admin-bg" />
            <div className="h-20 animate-pulse rounded-admin-sm bg-admin-bg" />
          </div>
        ) : error ? (
          <div className="rounded-admin-sm border border-red-100 bg-red-50 px-3 py-4 text-xs text-red-700">
            <p className="font-bold text-red-800">액션큐 확인이 필요합니다</p>
            <p className="mt-1 leading-relaxed">{error} 예약표는 계속 열 수 있습니다.</p>
            <button
              type="button"
              onClick={load}
              className="mt-3 rounded-admin-sm border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-800"
            >
              다시 불러오기
            </button>
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-admin-sm border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-4 text-center text-xs text-emerald-800">
            지금 바로 처리할 예약 작업이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((action) => (
              <BookingTaskActionCard
                key={action.id}
                action={action}
                compact
                mobileHref={`/m/admin/bookings/${action.bookingId}`}
                snoozeOpen={snoozeFor === action.id}
                onResolve={resolve}
                onSnooze={snooze}
                onToggleSnooze={(next) => setSnoozeFor((prev) => prev === next.id ? null : next.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
