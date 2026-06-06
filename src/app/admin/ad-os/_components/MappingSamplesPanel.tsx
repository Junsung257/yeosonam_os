import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Summary } from '../_lib/types';
import { PLATFORM_LABEL, STATUS_LABEL } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function MappingSamplesPanel({ rows }: { rows: Summary['samples']['mappings'] }) {
  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Mapping samples</h2>
        <Link href="/admin/blog/ads" className="inline-flex items-center gap-1 text-admin-xs font-semibold text-brand hover:underline">
          Open ads <ArrowRight size={12} />
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 8).map((row, idx) => (
          <div key={String(row.id || idx)} className="flex items-center justify-between gap-3 rounded-admin-sm bg-admin-surface-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-admin-sm font-semibold text-admin-text">{String(row.keyword || '-')}</p>
              <p className="text-admin-2xs text-admin-muted">{PLATFORM_LABEL[String(row.platform)] || String(row.platform || '')}</p>
            </div>
            <StatusPill>{STATUS_LABEL[String(row.operational_status)] || String(row.operational_status || 'candidate')}</StatusPill>
          </div>
        ))}
      </div>
    </section>
  );
}
