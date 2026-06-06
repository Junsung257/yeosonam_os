import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

export function RecentDecisionsPanel({ rows }: { rows: Summary['recent_decisions'] }) {
  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Recent decisions</h2>
        <StatusPill tone={rows.length > 0 ? 'good' : 'neutral'}>{rows.length}</StatusPill>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
            No recent automation decisions yet. Guarded runs will record reasons and applied state here.
          </div>
        ) : (
          rows.slice(0, 8).map((row, idx) => (
            <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-admin-xs font-semibold text-admin-text">{String(row.decision_type || '-')}</p>
                <StatusPill tone={row.applied ? 'good' : 'neutral'}>{row.applied ? 'Applied' : 'Pending'}</StatusPill>
              </div>
              <p className="mt-1 line-clamp-2 text-admin-2xs text-admin-muted">{String(row.reason || '')}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
