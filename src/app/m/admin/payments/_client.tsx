'use client';

import { Virtuoso } from 'react-virtuoso';
import { useRouter } from 'next/navigation';
import { MobileCard } from '@/components/admin/mobile/MobileCard';
import { fmtK } from '@/lib/admin-utils';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import type { MobilePaymentRow } from './page';

const MATCH_COLORS: Record<string, string> = {
  auto: 'bg-emerald-100 text-emerald-700',
  manual: 'bg-emerald-100 text-emerald-700',
  review: 'bg-amber-100 text-amber-700',
  unmatched: 'bg-rose-100 text-rose-700',
};

const MATCH_LABELS: Record<string, string> = {
  auto: '자동',
  manual: '수동',
  review: '검토',
  unmatched: '미매칭',
};

function MatchBadge({ status }: { status: string }) {
  const cls = MATCH_COLORS[status] ?? 'bg-slate-100 text-slate-600';
  const label = MATCH_LABELS[status] ?? status;
  return (
    <span
      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}
    >
      {label}
    </span>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
  });
}

export default function PaymentsClient({
  rows,
}: {
  rows: MobilePaymentRow[];
}) {
  const router = useRouter();
  useRealtimeRefresh({
    table: 'bank_transactions',
    events: ['INSERT', 'UPDATE'],
    onChange: () => router.refresh(),
  });

  if (rows.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-sm text-slate-400">
        표시할 입금 내역이 없습니다.
      </div>
    );
  }

  return (
    <Virtuoso
      useWindowScroll
      data={rows}
      itemContent={(_, row) => (
        <div className="px-3 py-1.5">
          <MobileCard
            href={`/m/admin/payments/${row.id}`}
            badge={<MatchBadge status={row.match_status} />}
            title={row.counterparty_name ?? '입금자 미상'}
            subtitle={
              row.matched_booking
                ? `${row.matched_booking.booking_no ?? ''} · ${row.matched_booking.customer_name ?? ''}`
                : row.memo ?? '매칭된 예약 없음'
            }
            rightValue={
              <span className="tabular-nums text-emerald-700">
                +{fmtK(row.amount)}
              </span>
            }
            meta={
              <>
                <span>{relTime(row.received_at)}</span>
                {row.match_confidence != null && row.match_status !== 'auto' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      신뢰도 {Math.round((row.match_confidence ?? 0) * 100)}%
                    </span>
                  </>
                )}
                {row.matched_booking?.package_title && (
                  <span className="ml-auto truncate max-w-[40%]">
                    {row.matched_booking.package_title}
                  </span>
                )}
              </>
            }
          />
        </div>
      )}
    />
  );
}
