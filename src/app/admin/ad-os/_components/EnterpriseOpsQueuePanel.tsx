import { AlertTriangle, CheckCircle2, PlayCircle } from 'lucide-react';
import type { Summary } from '../_lib/types';
import { OpsQueueList, type OpsQueueAction } from './OpsQueueList';
import { StatusPill } from './StatusPill';

type EnterpriseLayer = NonNullable<Summary['enterprise_layer']>;
type OpsQueues = EnterpriseLayer['ops_queues'];

export function EnterpriseOpsQueuePanel({
  opsQueues,
  executorRows,
  confirmationRows,
  failedRows,
  loadingId,
  onAction,
}: {
  opsQueues: OpsQueues;
  executorRows: Array<Record<string, unknown>>;
  confirmationRows: Array<Record<string, unknown>>;
  failedRows: Array<Record<string, unknown>>;
  loadingId: string | null;
  onAction: (row: Record<string, unknown>, action: OpsQueueAction) => void;
}) {
  return (
    <div className="mt-5 border-t border-admin-border pt-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-admin-sm font-semibold text-admin-text-2">Operations queue</h3>
          <p className="mt-1 text-admin-xs text-admin-muted">
            {opsQueues?.next_action || 'Review ready execution jobs, confirmations, and blocked work before any live write path.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={(opsQueues?.executor_ready || 0) > 0 ? 'warn' : 'neutral'}>
            executor {Number(opsQueues?.executor_ready || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.confirmation_pending || 0) > 0 ? 'warn' : 'neutral'}>
            confirm {Number(opsQueues?.confirmation_pending || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.failed_or_blocked || 0) > 0 ? 'bad' : 'good'}>
            blocked {Number(opsQueues?.failed_or_blocked || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.live_writes || 0) === 0 ? 'good' : 'bad'}>
            live write {Number(opsQueues?.live_writes || 0).toLocaleString('ko-KR')}
          </StatusPill>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">Execution queue</h4>
            <PlayCircle size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={executorRows}
            empty="No approved execution jobs are waiting for dry-run."
            loadingId={loadingId}
            onAction={onAction}
            actions={['executor_dry_run']}
          />
        </div>

        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">Result confirmation</h4>
            <CheckCircle2 size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={confirmationRows}
            empty="No failed external result confirmation is pending."
            loadingId={loadingId}
            onAction={onAction}
            actions={['confirm_failed']}
          />
        </div>

        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">Failed or blocked</h4>
            <AlertTriangle size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={failedRows}
            empty="No blocked job or failed executor attempt is waiting for acknowledgement."
            loadingId={loadingId}
            onAction={onAction}
            actions={['acknowledge_blocker']}
          />
        </div>
      </div>
    </div>
  );
}
