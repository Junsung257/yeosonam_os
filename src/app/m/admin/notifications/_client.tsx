'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import type { NotifRow } from './page';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  return `${day}일 전`;
}

const KIND_COLOR: Record<string, string> = {
  new_booking: 'bg-blue-100 text-blue-700',
  payment_review: 'bg-amber-100 text-amber-700',
  payment_unmatched: 'bg-rose-100 text-rose-700',
  fully_paid: 'bg-emerald-100 text-emerald-700',
};

const KIND_LABEL: Record<string, string> = {
  new_booking: '신규 예약',
  payment_review: '입금 검토',
  payment_unmatched: '입금 확인',
  fully_paid: '완납',
};

export default function NotificationsClient({ rows }: { rows: NotifRow[] }) {
  const router = useRouter();
  useRealtimeRefresh({
    table: 'push_notifications',
    events: ['INSERT'],
    onChange: () => router.refresh(),
  });

  if (rows.length === 0) {
    return (
      <div className="px-4 py-20 text-center text-sm text-slate-400">
        아직 받은 알림이 없습니다.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 bg-white">
      {rows.map(n => {
        const unread = !n.read_at;
        const body = (
          <div className={`px-4 py-3 ${unread ? 'bg-white' : 'bg-slate-50'}`}>
            <div className="flex items-center gap-2 mb-0.5">
              {n.kind && KIND_LABEL[n.kind] && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    KIND_COLOR[n.kind] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {KIND_LABEL[n.kind]}
                </span>
              )}
              <span className="text-xs text-slate-400">
                {relTime(n.created_at)}
              </span>
              {unread && (
                <span className="w-2 h-2 rounded-full bg-blue-500 ml-auto" />
              )}
            </div>
            <div
              className={`text-sm ${unread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
            >
              {n.title}
            </div>
            {n.body && (
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {n.body}
              </div>
            )}
          </div>
        );
        return (
          <li key={n.id}>
            {n.deep_link ? (
              <Link
                href={n.deep_link}
                className="block active:bg-slate-100"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
