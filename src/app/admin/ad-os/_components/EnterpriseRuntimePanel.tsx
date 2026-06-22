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
  const externalApiWriteCount = Number(summary.enterprise_layer?.platform_job_queue?.external_api_write_count || 0);

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">고급 실행 점검</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            실행 점검, 전환 업로드 점검, 채널 연결 패킷을 확인하고 실제 외부 반영 여부를 표시합니다.
          </p>
        </div>
        <StatusPill tone={externalApiWriteCount === 0 ? 'good' : 'bad'}>
          외부 반영 {externalApiWriteCount.toLocaleString('ko-KR')}
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
