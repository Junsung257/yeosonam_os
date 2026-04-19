'use client';

import { useRouter } from 'next/navigation';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import type { TimelineRow } from './page';

const EVENT_ICON: Record<string, string> = {
  DEPOSIT_NOTICE: '📨',
  DEPOSIT_CONFIRMED: '💰',
  BALANCE_NOTICE: '📬',
  BALANCE_CONFIRMED: '✅',
  CONFIRMATION_GUIDE: '📋',
  HAPPY_CALL: '📞',
  CANCELLATION: '⛔',
  MANUAL_MEMO: '📝',
  PAYMENT_OUT: '🏢',
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TimelineClient({
  bookingId,
  rows,
}: {
  bookingId: string;
  rows: TimelineRow[];
}) {
  const router = useRouter();
  useRealtimeRefresh({
    table: 'message_logs',
    events: ['INSERT'],
    filter: `booking_id=eq.${bookingId}`,
    onChange: () => router.refresh(),
  });

  if (rows.length === 0) {
    return (
      <div className="px-4 py-20 text-center text-sm text-slate-400">
        기록된 이벤트가 없습니다.
      </div>
    );
  }

  return (
    <main className="px-4 py-4">
      <ol className="relative border-l border-slate-200 pl-5 space-y-4">
        {rows.map(r => (
          <li key={r.id} className="relative">
            <span className="absolute -left-[29px] top-0 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-sm">
              {(r.event_type && EVENT_ICON[r.event_type]) || '•'}
            </span>
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-slate-900">
                  {r.title ?? r.event_type ?? '이벤트'}
                </span>
                {r.is_mock && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                    🧪 Mock
                  </span>
                )}
              </div>
              {r.content && (
                <p className="text-xs text-slate-600 whitespace-pre-wrap">
                  {r.content}
                </p>
              )}
              <div className="text-[10px] text-slate-400 mt-1">
                {formatTs(r.created_at)}
                {r.created_by ? ` · ${r.created_by}` : ''}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
