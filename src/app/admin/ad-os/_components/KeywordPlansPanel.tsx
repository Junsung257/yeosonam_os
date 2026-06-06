import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { Summary } from '../_lib/types';
import { fmtWon, PLATFORM_LABEL, STATUS_LABEL } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function KeywordPlansPanel({
  rows,
  loadingId,
  onUpdate,
}: {
  rows: Summary['samples']['keyword_plans'];
  loadingId: string | null;
  onUpdate: (id: string, action: 'approve' | 'archive') => void;
}) {
  return (
    <section className="admin-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-admin-text-2">Keyword plan samples</h2>
        <Link href="/admin/search-ads" className="inline-flex items-center gap-1 text-admin-xs font-semibold text-brand hover:underline">
          Open search ads <ArrowRight size={12} />
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
            No keyword plans yet. Generated candidates will appear here after product and search-term planning runs.
          </div>
        ) : (
          rows.slice(0, 8).map((row, idx) => {
            const id = String(row.id || idx);
            const status = String(row.autopilot_status || row.plan_status || 'candidate');

            return (
              <div key={id} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-admin-sm font-semibold text-admin-text">{String(row.keyword_text || '-')}</p>
                    <p className="text-admin-2xs text-admin-muted">
                      {PLATFORM_LABEL[String(row.platform)] || String(row.platform || '')} - {String(row.tier || '-')} - {fmtWon(Number(row.suggested_bid_krw || 0))}
                    </p>
                  </div>
                  <StatusPill>{STATUS_LABEL[status] || status}</StatusPill>
                </div>
                {status === 'candidate' && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onUpdate(id, 'approve')} loading={loadingId === id}>
                      <Check size={13} />
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onUpdate(id, 'archive')} loading={loadingId === id}>
                      <X size={13} />
                      Archive
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
