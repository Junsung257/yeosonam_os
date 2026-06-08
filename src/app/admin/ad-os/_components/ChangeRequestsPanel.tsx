import { Check, PlayCircle, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { Summary } from '../_lib/types';
import { StatusPill } from './StatusPill';

type ChangeRequestRow = NonNullable<Summary['samples']['change_requests']>[number];

function isGoogleRsaDraftRequest(row: ChangeRequestRow): boolean {
  return (
    String(row.platform || '') === 'google' &&
    String(row.request_type || '') === 'create_creative_draft' &&
    String(row.target_table || '') === 'ad_os_creative_asset_variants'
  );
}

export function ChangeRequestsPanel({
  count,
  rows,
  loadingId,
  onUpdate,
}: {
  count: number;
  rows: NonNullable<Summary['samples']['change_requests']>;
  loadingId: string | null;
  onUpdate: (id: string, status: 'approved' | 'rejected' | 'applied' | 'rolled_back') => void;
}) {
  const googleRsaDraftCount = rows.filter(isGoogleRsaDraftRequest).length;
  const displayRows = [...rows].sort((a, b) => Number(isGoogleRsaDraftRequest(b)) - Number(isGoogleRsaDraftRequest(a)));

  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Change requests</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {googleRsaDraftCount > 0 && (
            <StatusPill tone="good">Google RSA drafts {googleRsaDraftCount}</StatusPill>
          )}
          <StatusPill tone={count > 0 ? 'warn' : 'neutral'}>{count}</StatusPill>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
            No change requests are waiting for approval. High-risk budget, bid, and content changes will appear here.
          </div>
        ) : (
          displayRows.slice(0, 6).map((row, idx) => {
            const id = String(row.id || '');
            const status = String(row.status || '');
            const googleRsaDraft = isGoogleRsaDraftRequest(row);

            return (
              <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-admin-xs font-semibold text-admin-text">{String(row.title || row.request_type || '-')}</p>
                  <StatusPill tone={['high', 'critical'].includes(String(row.risk_level || '')) ? 'bad' : row.status === 'proposed' ? 'warn' : 'good'}>
                    {String(row.status || '-')}
                  </StatusPill>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-admin-2xs text-admin-muted">
                  {googleRsaDraft && <StatusPill tone="good">Google RSA draft</StatusPill>}
                  <span>
                    {String(row.platform || 'internal')} - {String(row.risk_level || 'medium')} - {String(row.reason || '').slice(0, 70)}
                  </span>
                </div>
                {status === 'proposed' && id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onUpdate(id, 'approved')} loading={loadingId === id}>
                      <Check size={13} />
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onUpdate(id, 'rejected')} loading={loadingId === id}>
                      <X size={13} />
                      Reject
                    </Button>
                  </div>
                )}
                {status === 'approved' && id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onUpdate(id, 'applied')} loading={loadingId === id}>
                      <PlayCircle size={13} />
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onUpdate(id, 'rolled_back')} loading={loadingId === id}>
                      <X size={13} />
                      Roll back
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
