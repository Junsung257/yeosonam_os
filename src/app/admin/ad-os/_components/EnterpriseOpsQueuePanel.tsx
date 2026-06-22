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
          <h3 className="text-admin-sm font-semibold text-admin-text-2">운영 대기열</h3>
          <p className="mt-1 text-admin-xs text-admin-muted">
            {opsQueues?.next_action || '실제 반영 전에 실행 대기, 결과 확인, 막힌 작업을 검토하세요.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={(opsQueues?.executor_ready || 0) > 0 ? 'warn' : 'neutral'}>
            실행 대기 {Number(opsQueues?.executor_ready || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.confirmation_pending || 0) > 0 ? 'warn' : 'neutral'}>
            확인 대기 {Number(opsQueues?.confirmation_pending || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.failed_or_blocked || 0) > 0 ? 'bad' : 'good'}>
            막힘 {Number(opsQueues?.failed_or_blocked || 0).toLocaleString('ko-KR')}
          </StatusPill>
          <StatusPill tone={(opsQueues?.live_writes || 0) === 0 ? 'good' : 'bad'}>
            외부 반영 {Number(opsQueues?.live_writes || 0).toLocaleString('ko-KR')}
          </StatusPill>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">실행 대기</h4>
            <PlayCircle size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={executorRows}
            empty="사전 점검을 기다리는 승인 작업이 없습니다."
            loadingId={loadingId}
            onAction={onAction}
            actions={['executor_dry_run']}
          />
        </div>

        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">결과 확인</h4>
            <CheckCircle2 size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={confirmationRows}
            empty="확인해야 할 외부 결과가 없습니다."
            loadingId={loadingId}
            onAction={onAction}
            actions={['confirm_failed']}
          />
        </div>

        <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-admin-xs font-semibold text-admin-text">실패/막힘</h4>
            <AlertTriangle size={14} className="text-admin-muted" />
          </div>
          <OpsQueueList
            rows={failedRows}
            empty="확인 대기 중인 실패 또는 막힌 작업이 없습니다."
            loadingId={loadingId}
            onAction={onAction}
            actions={['acknowledge_blocker']}
          />
        </div>
      </div>
    </div>
  );
}
