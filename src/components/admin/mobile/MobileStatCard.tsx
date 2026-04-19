'use client';

import Link from 'next/link';

interface MobileStatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'slate' | 'amber' | 'blue' | 'rose' | 'emerald';
  href?: string;
}

const TONE_MAP: Record<NonNullable<MobileStatCardProps['tone']>, string> = {
  slate: 'bg-slate-900 text-white',
  amber: 'bg-amber-50 text-amber-900 border-amber-200',
  blue: 'bg-blue-50 text-blue-900 border-blue-200',
  rose: 'bg-rose-50 text-rose-900 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
};

export function MobileStatCard({
  label,
  value,
  hint,
  icon,
  tone = 'slate',
  href,
}: MobileStatCardProps) {
  const toneCls = TONE_MAP[tone];
  const borderedTone = tone !== 'slate';

  const body = (
    <div
      className={`rounded-2xl px-4 py-4 ${toneCls} ${
        borderedTone ? 'border' : ''
      } active:scale-[0.98] transition`}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium opacity-80">{label}</div>
        {icon && <span className="opacity-70">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs opacity-70">{hint}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}
