'use client';

import { useEffect, useState } from 'react';
import { BookingTaskActionCard } from './BookingTaskActionCard';
import type { BookingOpsSummary } from '@/lib/booking-ops';

export function MobileBookingOpsQueue() {
  const [summary, setSummary] = useState<BookingOpsSummary | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/booking-ops/summary?limit=5', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data: BookingOpsSummary | null) => {
        if (alive) setSummary(data);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, []);

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

        {actions.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-bg px-3 py-4 text-center text-xs text-admin-muted">
            지금 처리할 예약 작업이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((action) => (
              <BookingTaskActionCard
                key={action.id}
                action={action}
                compact
                mobileHref={`/m/admin/bookings/${action.bookingId}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
