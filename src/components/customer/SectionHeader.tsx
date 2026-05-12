/**
 * 섹션 헤더 — 야놀자 구조 + 토스 UI
 * 대제목(22px/700) + 부제(12px/muted) + 우측 더보기 링크(14px/brand)
 * border 제거, 여백으로 구분 (토스 스타일)
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

export default function SectionHeader({ title, subtitle, action, actionHref, actionLabel, className = '' }: Props) {
  const rightSlot =
    action ??
    (actionHref && actionLabel ? (
      <Link
        href={actionHref}
        className="text-body font-medium text-brand hover:opacity-80 whitespace-nowrap transition-opacity"
      >
        {actionLabel}
      </Link>
    ) : null);

  return (
    <header className={`mb-4 md:mb-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h1 font-bold tracking-[-0.02em] text-text-primary leading-[1.4]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-micro text-text-secondary tracking-[-0.01em]">{subtitle}</p>
          )}
        </div>
        {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
      </div>
    </header>
  );
}
