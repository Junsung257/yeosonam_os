import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

export function LandingEvolutionPanel({
  count,
  rows,
}: {
  count: number;
  rows: NonNullable<Summary['samples']['landing_evolution_queue']>;
}) {
  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Blog landing evolution</h2>
        <StatusPill tone={count > 0 ? 'warn' : 'neutral'}>{count}</StatusPill>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
            No landing evolution candidates yet. CTA, scroll, booking, and conversion signals will create content updates here.
          </div>
        ) : (
          rows.slice(0, 6).map((row, idx) => (
            <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-admin-xs font-semibold text-admin-text">{String(row.action || '-')}</p>
                <StatusPill tone={row.status === 'candidate' ? 'warn' : 'good'}>{String(row.status || '-')}</StatusPill>
              </div>
              <p className="mt-1 text-admin-2xs text-admin-muted">{String(row.reason || '').slice(0, 90)}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
