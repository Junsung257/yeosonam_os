import type { Summary } from '../_lib/types';
import {
  EnterpriseRuntimeActionBar,
  type EnterpriseRuntimeActionHandlers,
  type EnterpriseRuntimeActionLoading,
} from './EnterpriseRuntimeActionBar';
import { EnterpriseOpsQueuePanel } from './EnterpriseOpsQueuePanel';
import type { OpsQueueAction } from './OpsQueueList';
import { StatusPill } from './StatusPill';

export function EnterpriseRuntimePanel({
  summary,
  actions,
  loading,
  opsQueueActionId,
  onOpsQueueAction,
}: {
  summary: Summary;
  actions: EnterpriseRuntimeActionHandlers;
  loading: EnterpriseRuntimeActionLoading;
  opsQueueActionId: string | null;
  onOpsQueueAction: (row: Record<string, unknown>, action: OpsQueueAction) => void;
}) {
  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">Enterprise runtime</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Runs runtime checks, dry-run executors, conversion upload checks, and adapter packets with live-write evidence visible.
          </p>
        </div>
        <StatusPill tone={Number(summary.enterprise_layer?.platform_job_queue.external_api_write_count || 0) === 0 ? 'good' : 'bad'}>
          external write {Number(summary.enterprise_layer?.platform_job_queue.external_api_write_count || 0).toLocaleString('ko-KR')}
        </StatusPill>
      </div>
      <EnterpriseRuntimeActionBar actions={actions} loading={loading} />
      {summary.enterprise_layer?.ops_queues && (
        <EnterpriseOpsQueuePanel
          opsQueues={summary.enterprise_layer.ops_queues}
          executorRows={summary.samples.ops_executor_queue || []}
          confirmationRows={summary.samples.ops_confirmation_queue || []}
          failedRows={summary.samples.ops_failed_queue || []}
          loadingId={opsQueueActionId}
          onAction={onOpsQueueAction}
        />
      )}
    </section>
  );
}
