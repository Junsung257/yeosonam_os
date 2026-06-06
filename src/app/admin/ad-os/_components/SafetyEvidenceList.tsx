import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusPill, type StatusPillTone } from './StatusPill';

export type SafetyEvidenceItem = {
  id: string;
  label: string;
  evidence: string;
  nextAction: string;
  status: string;
  tone: StatusPillTone;
  href?: string;
  hrefLabel?: string;
  meta?: string;
};

export function SafetyEvidenceList({
  items,
  empty,
  containerClassName = 'mt-3 grid grid-cols-1 gap-2 md:grid-cols-2',
  itemClassName = 'rounded-admin-xs bg-admin-surface-2 px-3 py-2',
  emptyClassName = 'rounded-admin-xs bg-admin-surface-2 px-3 py-2 text-admin-2xs text-admin-muted md:col-span-2',
}: {
  items: SafetyEvidenceItem[];
  empty: string;
  containerClassName?: string;
  itemClassName?: string;
  emptyClassName?: string;
}) {
  return (
    <div className={containerClassName}>
      {items.length > 0 ? items.map((item) => (
        <div key={item.id} className={itemClassName}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-admin-2xs font-semibold text-admin-text">{item.label}</p>
              <p className="mt-0.5 truncate text-admin-2xs text-admin-muted">{item.evidence}</p>
            </div>
            <StatusPill tone={item.tone}>{item.status}</StatusPill>
          </div>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted md:col-span-2">{item.nextAction}</p>
          {(item.href || item.meta) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 md:col-span-2">
              {item.href && (
                <Link href={item.href} className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
                  {item.hrefLabel || '보기'} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
              {item.meta && (
                <span className="truncate text-admin-2xs text-admin-muted">{item.meta}</span>
              )}
            </div>
          )}
        </div>
      )) : (
        <p className={emptyClassName}>{empty}</p>
      )}
    </div>
  );
}
