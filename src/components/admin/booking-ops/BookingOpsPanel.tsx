'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { BookingTaskActionCard } from './BookingTaskActionCard';
import type { BookingOpsAction, BookingOpsSummary } from '@/lib/booking-ops';

function fmtMoney(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 10_000)}만`;
  return value.toLocaleString('ko-KR');
}

function metricTone(value: number, danger = false): string {
  if (value <= 0) return 'text-admin-muted-2';
  return danger ? 'text-red-600' : 'text-admin-text';
}

interface BookingOpsPanelProps {
  className?: string;
  compact?: boolean;
  limit?: number;
  bookingId?: string;
  highlightedTaskId?: string | null;
  onOpenBooking?: (bookingId: string, action?: BookingOpsAction) => void;
}

export function BookingOpsPanel({
  className = '',
  compact = false,
  limit = 6,
  bookingId,
  highlightedTaskId,
  onOpenBooking,
}: BookingOpsPanelProps) {
  const [summary, setSummary] = useState<BookingOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const openedTaskRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (bookingId) params.set('booking_id', bookingId);
      if (highlightedTaskId) params.set('task_id', highlightedTaskId);
      const res = await fetch(`/api/admin/booking-ops/summary?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as BookingOpsSummary;
      setSummary(data);
      if (
        highlightedTaskId &&
        data.highlightedAction &&
        openedTaskRef.current !== highlightedTaskId
      ) {
        openedTaskRef.current = highlightedTaskId;
        onOpenBooking?.(data.highlightedAction.bookingId, data.highlightedAction);
      }
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [bookingId, highlightedTaskId, limit, onOpenBooking]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = summary?.metrics;
  const actions = useMemo(() => summary?.actions ?? [], [summary]);
  const paymentCandidates = summary?.paymentMatchCandidates ?? [];
  const ruleSignals = (summary?.ruleHealth ?? [])
    .filter((rule) => rule.tuneReason !== '정상' || rule.tuneScore >= 10)
    .slice(0, 4);

  return (
    <section className={`rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-xs ${className}`}>
      <div className={`flex items-center justify-between gap-3 border-b border-admin-border ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div>
          <h2 className="text-admin-base font-bold text-admin-text">오늘 처리</h2>
          <p className="text-admin-xs text-admin-muted">
            예약 자동화 큐 기준으로 우선순위를 정렬합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/inbox"
            className="rounded-admin-sm border border-admin-border-mid px-3 py-1.5 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2"
          >
            전체 큐
          </Link>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-8 w-8 items-center justify-center rounded-admin-sm border border-admin-border-mid text-admin-muted hover:bg-admin-surface-2 hover:text-admin-text"
            aria-label="예약 운영판 새로고침"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className={`${compact ? 'p-3' : 'p-4'} space-y-3`}>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {[
            ['긴급', metrics?.urgentOpen ?? 0, true],
            ['오늘', metrics?.todayOpen ?? 0, true],
            ['보류', metrics?.snoozed ?? 0, false],
            ['자동해결', metrics?.autoResolved24h ?? 0, false],
            ['48h 초과', metrics?.staleOver48h ?? 0, true],
            ['입금대기', (metrics?.unmatchedBank ?? 0) + (metrics?.bankReview ?? 0), true],
          ].map(([label, value, danger]) => (
            <div key={String(label)} className="rounded-admin-sm bg-admin-bg px-3 py-2">
              <div className={`text-admin-lg font-bold tabular-nums ${metricTone(Number(value), Boolean(danger))}`}>
                {value}
              </div>
              <div className="text-admin-2xs font-semibold uppercase text-admin-muted-2">{label}</div>
            </div>
          ))}
        </div>

        {!compact && metrics && (
          <div className="grid grid-cols-2 gap-2 text-admin-xs md:grid-cols-4">
            <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <span className="text-admin-muted">진행 예약</span>
              <b className="ml-2 tabular-nums text-admin-text">{metrics.activeBookings}건</b>
            </div>
            <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <span className="text-admin-muted">총 판매</span>
              <b className="ml-2 tabular-nums text-admin-text">{fmtMoney(metrics.totalSales)}</b>
            </div>
            <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <span className="text-admin-muted">미수 잔금</span>
              <b className="ml-2 tabular-nums text-red-600">{fmtMoney(metrics.totalBalance)}</b>
            </div>
            <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <span className="text-admin-muted">자동해결률</span>
              <b className="ml-2 tabular-nums text-admin-text">{metrics.autoResolveRatePct}%</b>
            </div>
          </div>
        )}

        {!compact && paymentCandidates.length > 0 && (
          <div className="rounded-admin-sm border border-emerald-100 bg-emerald-50/40 px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-admin-sm font-bold text-emerald-900">입금 매칭 후보</div>
                <div className="text-admin-xs text-emerald-700">미매칭 입금 중 자동/검토 가능성이 높은 항목입니다.</div>
              </div>
              <Link
                href="/admin/payments?filter=unmatched"
                className="rounded-admin-sm border border-emerald-200 bg-white px-2 py-1 text-admin-xs font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                입금 관리
              </Link>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {paymentCandidates.slice(0, 4).map((candidate) => {
                const top = candidate.candidates[0];
                return (
                  <Link
                    key={candidate.transactionId}
                    href={`/admin/payments?filter=unmatched&tx=${encodeURIComponent(candidate.transactionId)}${top?.bookingId ? `&booking=${encodeURIComponent(top.bookingId)}` : ''}`}
                    className="rounded-admin-sm border border-emerald-100 bg-white px-3 py-2 hover:border-emerald-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-admin-xs font-semibold text-admin-text">
                          {candidate.counterpartyName ?? '입금자 미상'} · {fmtMoney(candidate.amount)}
                        </div>
                        <div className="mt-0.5 truncate text-admin-xs text-admin-muted">
                          {top?.bookingNo ?? '예약번호 없음'} · {top?.customerName ?? '고객 미상'}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-admin-xs bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        {candidate.topConfidence}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {!compact && ruleSignals.length > 0 && (
          <div className="rounded-admin-sm border border-amber-100 bg-amber-50/50 px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-admin-sm font-bold text-amber-900">룰 튜닝 신호</div>
                <div className="text-admin-xs text-amber-700">오래 쌓이거나 자동해결률이 낮은 예약 자동화 룰입니다.</div>
              </div>
              <Link
                href="/admin/inbox"
                className="rounded-admin-sm border border-amber-200 bg-white px-2 py-1 text-admin-xs font-semibold text-amber-800 hover:bg-amber-50"
              >
                액션큐
              </Link>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {ruleSignals.map((rule) => (
                <div key={rule.taskType} className="rounded-admin-sm border border-amber-100 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-admin-xs font-semibold text-admin-text">
                        {rule.taskTypeLabel}
                      </div>
                      <div className="mt-0.5 text-admin-xs text-admin-muted">
                        {rule.tuneReason} · 오픈 {rule.open} · 48h {rule.staleOver48h}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-admin-xs bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      {Math.round(rule.tuneScore)}점
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-admin-muted-2">
                    자동해결 {rule.autoResolveRatePct}% · 보류 {rule.snoozed}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && !summary ? (
          <div className="grid gap-2 md:grid-cols-2">
            {Array.from({ length: compact ? 2 : 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-admin-sm bg-admin-surface-2" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-admin-sm border border-dashed border-admin-border px-4 py-6 text-center">
            <div className="text-admin-sm font-semibold text-admin-text">처리할 예약 작업이 없습니다.</div>
            <div className="mt-1 text-admin-xs text-admin-muted">새 예약이나 예외가 생기면 이곳에 먼저 올라옵니다.</div>
          </div>
        ) : (
          <div className={`grid gap-2 ${compact ? '' : 'xl:grid-cols-2'}`}>
            {actions.map((action) => (
              <BookingTaskActionCard
                key={action.id}
                action={action}
                compact={compact}
                active={action.id === highlightedTaskId}
                onOpen={(next) => onOpenBooking?.(next.bookingId, next)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
