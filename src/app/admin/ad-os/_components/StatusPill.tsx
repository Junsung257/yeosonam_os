import type { ReactNode } from 'react';

export type StatusPillTone = 'neutral' | 'good' | 'warn' | 'bad';

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: StatusPillTone;
}) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'bad'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-admin-surface-2 text-admin-muted';
  return <span className={`inline-flex items-center rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${cls}`}>{children}</span>;
}
