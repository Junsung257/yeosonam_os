'use client';

import Link from 'next/link';

interface MobileCardProps {
  href?: string;
  onClick?: () => void;
  onLongPress?: () => void;
  badge?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  rightValue?: React.ReactNode;
  meta?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function MobileCard({
  href,
  onClick,
  onLongPress,
  badge,
  title,
  subtitle,
  rightValue,
  meta,
  footer,
  className = '',
}: MobileCardProps) {
  const body = (
    <div
      className={`bg-white border border-slate-200 rounded-2xl px-4 py-3 active:bg-slate-50 transition-colors ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            {badge}
            <div className="text-sm font-semibold text-slate-900 truncate">
              {title}
            </div>
          </div>
          {subtitle && (
            <div className="text-xs text-slate-500 truncate">{subtitle}</div>
          )}
        </div>
        {rightValue != null && (
          <div className="shrink-0 text-right text-sm font-semibold text-slate-900 tabular-nums">
            {rightValue}
          </div>
        )}
      </div>
      {meta && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {meta}
        </div>
      )}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );

  const longPressHandlers = onLongPress
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          const target = e.currentTarget as HTMLElement & {
            _lpTimer?: ReturnType<typeof setTimeout>;
          };
          target._lpTimer = setTimeout(() => {
            onLongPress();
          }, 500);
        },
        onTouchEnd: (e: React.TouchEvent) => {
          const target = e.currentTarget as HTMLElement & {
            _lpTimer?: ReturnType<typeof setTimeout>;
          };
          if (target._lpTimer) clearTimeout(target._lpTimer);
        },
        onTouchMove: (e: React.TouchEvent) => {
          const target = e.currentTarget as HTMLElement & {
            _lpTimer?: ReturnType<typeof setTimeout>;
          };
          if (target._lpTimer) clearTimeout(target._lpTimer);
        },
      }
    : {};

  if (href) {
    return (
      <Link href={href} className="block" {...longPressHandlers}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
        {...longPressHandlers}
      >
        {body}
      </button>
    );
  }
  return <div {...longPressHandlers}>{body}</div>;
}
