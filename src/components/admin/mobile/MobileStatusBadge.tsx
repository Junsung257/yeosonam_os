'use client';

import {
  getStatusBadgeClass,
  getStatusLabel,
} from '@/lib/booking-state-machine';

interface MobileStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function MobileStatusBadge({
  status,
  size = 'sm',
}: MobileStatusBadgeProps) {
  const base = getStatusBadgeClass(status);
  const sizeCls =
    size === 'md'
      ? 'text-xs px-2.5 py-1 rounded-md'
      : 'text-[10px] px-1.5 py-0.5 rounded';
  return (
    <span className={`inline-block font-medium ${base} ${sizeCls}`}>
      {getStatusLabel(status)}
    </span>
  );
}
