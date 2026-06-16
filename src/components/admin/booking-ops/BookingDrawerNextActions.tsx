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
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);

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
    setBusyActionId(action.id);
    setFeedback(null);
    setActions((prev) => prev.filter((item) => !taskIds.includes(item.id)));
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: action.recommendedAction }),
      }),
    )).catch(() => null);
    if (!results || results.some((res) => !res.ok)) {
      setFeedback({ type: 'err', message: '처리 완료에 실패했습니다. 목록을 다시 확인했습니다.' });
      await load();
    } else {
      setFeedback({ type: 'ok', message: `${taskIds.length}개 작업을 처리 완료했습니다.` });
      onChanged?.();
    }
    setBusyActionId(null);
  }, [load, onChanged]);

  const snooze = useCallback(async (action: BookingOpsAction, hours: number) => {
    const taskIds = action.groupedTaskIds.length > 0 ? action.groupedTaskIds : [action.id];
    setBusyActionId(action.id);
    setFeedback(null);
    setSnoozeFor(null);
    setActions((prev) => prev.filter((item) => !taskIds.includes(item.id)));
    const results = await Promise.all(taskIds.map((taskId) =>
      fetch(`/api/admin/booking-tasks/${taskId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours }),
      }),
    )).catch(() => null);
    if (!results || results.some((res) => !res.ok)) {
      setFeedback({ type: 'err', message: '다시 알림 설정에 실패했습니다. 목록을 다시 확인했습니다.' });
      await load();
    } else {
      const label = hours < 24 ? `${hours}시간 후` : `${Math.round(hours / 24)}일 후`;
      setFeedback({ type: 'ok', message: `${taskIds.length}개 작업을 ${label} 다시 보도록 보류했습니다.` });
      onChanged?.();
    }
    setBusyActionId(null);
  }, [load, onChanged]);

  if (loading && actions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-100" />
        <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (actions.length === 0 && !feedback) return null;

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
      {feedback && (
        <div className={`mb-2 rounded-lg border px-3 py-2 text-[12px] font-semibold ${
          feedback.type === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {feedback.message}
        </div>
      )}
      <div className="space-y-2">
        {actions.map((action) => (
          <BookingTaskActionCard
            key={action.id}
            action={action}
            compact
            snoozeOpen={snoozeFor === action.id}
            busy={busyActionId === action.id}
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
