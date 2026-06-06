import type { Summary } from '../_lib/types';
import { STATUS_LABEL, pct } from '../_lib/display';

export function MappingStatusDistributionPanel({
  mappingsByStatus,
  total,
}: {
  mappingsByStatus: Summary['counts'][string] | undefined;
  total: number;
}) {
  return (
    <section className="admin-card p-4">
      <h2 className="text-admin-base font-semibold text-admin-text-2">Mapping status distribution</h2>
      <div className="mt-3 space-y-2">
        {Object.entries(mappingsByStatus || {}).map(([status, count]) => (
          <div key={status} className="flex items-center gap-3">
            <span className="w-20 text-admin-xs font-semibold text-admin-text">{STATUS_LABEL[status] || status}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-admin-surface-2">
              <div className="h-full bg-brand" style={{ width: pct(count, total) }} />
            </div>
            <span className="w-12 text-right text-admin-xs admin-num text-admin-muted">{count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
