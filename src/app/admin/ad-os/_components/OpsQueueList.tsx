'use client';

import Button from '@/components/ui/Button';
import { PLATFORM_LABEL, queueTone } from '../_lib/display';
import { StatusPill } from './StatusPill';

export type OpsQueueAction =
  | 'executor_dry_run'
  | 'confirm_failed'
  | 'acknowledge_blocker';

export function OpsQueueList({
  rows,
  empty,
  loadingId,
  onAction,
  actions = [],
}: {
  rows: Array<Record<string, unknown>>;
  empty: string;
  loadingId?: string | null;
  onAction?: (row: Record<string, unknown>, action: OpsQueueAction) => void;
  actions?: OpsQueueAction[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-admin-xs font-semibold text-admin-text">{String(row.title || row.source || '-')}</p>
              <p className="mt-0.5 text-admin-2xs text-admin-muted">
                {PLATFORM_LABEL[String(row.platform)] || String(row.platform || 'internal')} · {String(row.source || '-')}
              </p>
            </div>
            <StatusPill tone={queueTone(row.status)}>{String(row.status || '-')}</StatusPill>
          </div>
          {Boolean(row.reason || row.next_action) && (
            <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">
              {String(row.reason || row.next_action).slice(0, 120)}
            </p>
          )}
          {Boolean(row.reason && row.next_action) && (
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">
              다음: {String(row.next_action).slice(0, 120)}
            </p>
          )}
          {onAction && actions.length > 0 && String(row.id || '') && (
            <div className="mt-2 flex flex-wrap gap-2">
              {actions.includes('executor_dry_run') && ['platform_job', 'conversion_upload_job'].includes(String(row.source || '')) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAction(row, 'executor_dry_run')}
                  loading={loadingId === `${String(row.source)}:${String(row.id)}:executor_dry_run`}
                >
                  Dry-run
                </Button>
              )}
              {actions.includes('confirm_failed') && ['platform_job_confirmation', 'conversion_upload_confirmation'].includes(String(row.source || '')) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAction(row, 'confirm_failed')}
                  loading={loadingId === `${String(row.source)}:${String(row.id)}:confirm_failed`}
                >
                  실패 확정
                </Button>
              )}
              {actions.includes('acknowledge_blocker') && ['platform_job', 'conversion_upload_job', 'execution_attempt'].includes(String(row.source || '')) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAction(row, 'acknowledge_blocker')}
                  loading={loadingId === `${String(row.source)}:${String(row.id)}:acknowledge_blocker`}
                >
                  차단 확인
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
