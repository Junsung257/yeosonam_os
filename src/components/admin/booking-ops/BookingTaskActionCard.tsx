'use client';

import Link from 'next/link';
import { Clock, ExternalLink, CheckCircle2 } from 'lucide-react';
import {
  PRIORITY_BADGE_CLASS,
  PRIORITY_LABEL,
  SNOOZE_PRESETS,
} from '@/types/booking-tasks';
import type { BookingOpsAction } from '@/lib/booking-ops';

function ageLabel(minutes: number): string {
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

interface BookingTaskActionCardProps {
  action: BookingOpsAction;
  compact?: boolean;
  active?: boolean;
  mobileHref?: string;
  snoozeOpen?: boolean;
  onOpen?: (action: BookingOpsAction) => void;
  onResolve?: (action: BookingOpsAction) => void;
  onSnooze?: (action: BookingOpsAction, hours: number) => void;
  onToggleSnooze?: (action: BookingOpsAction) => void;
}

export function BookingTaskActionCard({
  action,
  compact = false,
  active = false,
  mobileHref,
  snoozeOpen = false,
  onOpen,
  onResolve,
  onSnooze,
  onToggleSnooze,
}: BookingTaskActionCardProps) {
  const hasInlineActions = onResolve || onSnooze || onToggleSnooze;
  const rootClass = `group rounded-admin-sm border bg-admin-surface transition ${
    active
      ? 'border-brand shadow-admin-sm'
      : action.priority === 0
        ? 'border-red-200 hover:border-red-300'
        : 'border-admin-border-mid hover:border-admin-border-strong hover:shadow-admin-xs'
  }`;
  const content = (
    <div className={`${rootClass} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-admin-xs px-2 py-0.5 text-[10px] font-bold ${PRIORITY_BADGE_CLASS[action.priority]}`}>
          {PRIORITY_LABEL[action.priority]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 text-admin-xs text-admin-muted">
              {action.taskTypeLabel}
            </span>
            <span className="rounded-admin-xs bg-blue-50 px-1.5 py-0.5 text-admin-xs font-semibold text-blue-700">
              {Math.round(action.score)}점
            </span>
            <span className="inline-flex items-center gap-1 text-admin-xs text-admin-muted-2">
              <Clock size={12} />
              {ageLabel(action.ageMinutes)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpen?.(action)}
            className="block w-full truncate text-left text-admin-sm font-semibold text-admin-text hover:text-brand"
          >
            {action.title}
          </button>
          <div className="mt-1 truncate text-admin-xs text-admin-muted">
            <b>{action.bookingNo ?? '예약번호 없음'}</b>
            {' · '}
            {action.customerName ?? '고객 미지정'}
            {' · '}
            {action.packageTitle ?? '상품 미지정'}
          </div>
          {action.departureDate && (
            <div className="mt-1 text-admin-xs text-admin-muted-2">
              출발 {action.departureDate}
            </div>
          )}
          {action.scoreReasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {action.scoreReasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded-admin-xs bg-admin-bg px-1.5 py-0.5 text-[10px] font-medium text-admin-muted"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
          {action.relatedActions.length > 0 && (
            <div className="mt-2 space-y-1 rounded-admin-sm bg-admin-bg px-2 py-1.5">
              {action.relatedActions.slice(0, compact ? 2 : 3).map((related) => (
                <div key={related.id} className="flex items-center justify-between gap-2 text-[11px] text-admin-muted">
                  <span className="truncate">
                    + {related.taskTypeLabel} · {related.title}
                  </span>
                  <span className="shrink-0 tabular-nums">{Math.round(related.score)}점</span>
                </div>
              ))}
              {action.relatedActions.length > (compact ? 2 : 3) && (
                <div className="text-[11px] font-semibold text-admin-muted-2">
                  외 {action.relatedActions.length - (compact ? 2 : 3)}건
                </div>
              )}
            </div>
          )}
        </div>
        {mobileHref ? (
          <Link
            href={mobileHref}
            className="mt-0.5 inline-flex h-8 items-center gap-1 rounded-admin-sm border border-admin-border-mid px-2 text-admin-xs font-medium text-admin-text-2 active:bg-admin-surface-2"
          >
            열기
            <ExternalLink size={12} />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onOpen?.(action)}
            className="mt-0.5 inline-flex h-8 items-center gap-1 rounded-admin-sm border border-admin-border-mid px-2 text-admin-xs font-medium text-admin-text-2 hover:bg-admin-surface-2"
          >
            {action.ctaLabel}
            <ExternalLink size={12} />
          </button>
        )}
      </div>

      {hasInlineActions && (
        <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-admin-border pt-3">
          {onResolve && (
            <button
              type="button"
              onClick={() => onResolve(action)}
              className="inline-flex h-8 items-center gap-1.5 rounded-admin-sm bg-success px-3 text-admin-xs font-semibold text-white hover:opacity-90"
            >
              <CheckCircle2 size={13} />
              처리 완료
            </button>
          )}
          {onToggleSnooze && (
            <div className="relative">
              <button
                type="button"
                onClick={() => onToggleSnooze(action)}
                className="inline-flex h-8 items-center gap-1.5 rounded-admin-sm border border-admin-border-mid px-3 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2"
              >
                <Clock size={13} />
                내일 다시
              </button>
              {snoozeOpen && onSnooze && (
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[128px] overflow-hidden rounded-admin-sm border border-admin-border-mid bg-admin-surface shadow-admin-md">
                  {SNOOZE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onSnooze(action, preset.hours)}
                      className="block w-full px-3 py-2 text-left text-admin-xs text-admin-text-2 hover:bg-admin-surface-2"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return content;
}
