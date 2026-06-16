'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookingTaskActionCard } from './BookingTaskActionCard';
import type { BookingOpsAction, BookingOpsSummary } from '@/lib/booking-ops';

interface BookingDrawerNextActionsProps {
  bookingId: string;
  onOpen?: (action: BookingOpsAction) => void;
  onChanged?: () => void;
}

export function BookingDrawerNextActions({
  bookingId,
  onOpen,
  onChanged,
}: BookingDrawerNextActionsProps) {
  const [actions, setActions] = useState<BookingOpsAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ booking_id: bookingId, limit: '6' });
      const res = await fetch(`/api/admin/booking-ops/summary?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const summary = (await res.json()) as BookingOpsSummary;
      setActions(summary.actions);
    } catch {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = useCallback(async (action: BookingOpsAction) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    setActions((prev) => prev.filter((item) => !taskIds.includes(item.id)));
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: action.recommendedAction }),
      }),
    ));
    if (results.some((res) => !res.ok)) await load();
    onChanged?.();
  }, [load, onChanged]);

  const snooze = useCallback(async (action: BookingOpsAction, hours: number) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    setSnoozeFor(null);
    setActions((prev) => prev.filter((item) => !taskIds.includes(item.id)));
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours }),
      }),
    ));
    if (results.some((res) => !res.ok)) await load();
    onChanged?.();
  }, [load, onChanged]);

  if (loading && actions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-100" />
        <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (actions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-extrabold text-blue-900">다음 추천 행동</h3>
        <button
          type="button"
          onClick={load}
          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
        >
          새로고침
        </button>
      </div>
      <div className="space-y-2">
        {actions.map((action) => (
          <BookingTaskActionCard
            key={action.id}
            action={action}
            compact
            snoozeOpen={snoozeFor === action.id}
            onOpen={onOpen}
            onResolve={resolve}
            onSnooze={snooze}
            onToggleSnooze={(next) => setSnoozeFor((prev) => prev === next.id ? null : next.id)}
          />
        ))}
      </div>
    </div>
  );
}
