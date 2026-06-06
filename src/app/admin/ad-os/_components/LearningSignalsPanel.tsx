import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

export function LearningSignalsPanel({
  count,
  rows,
}: {
  count: number;
  rows: Summary['samples']['learning_events'];
}) {
  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Performance learning signals</h2>
        <StatusPill tone={count > 0 ? 'good' : 'neutral'}>{count}</StatusPill>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
            No learning signals yet. CTA, booking, and conversion events will create optimization candidates here.
          </div>
        ) : (
          rows.slice(0, 6).map((row, idx) => (
            <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-admin-xs font-semibold text-admin-text">{String(row.signal_type || '-')}</p>
                <StatusPill tone={row.status === 'candidate' ? 'warn' : 'good'}>{String(row.status || '-')}</StatusPill>
              </div>
              <p className="mt-1 text-admin-2xs text-admin-muted">{String(row.recommendation || '').slice(0, 90)}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
