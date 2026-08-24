import type { SupabaseClient } from '@supabase/supabase-js';
import { getRun } from 'workflow/api';

import {
  requeueBlogContentOperationV4,
  terminalizeBlogContentOperationV4,
} from './repository';

type ExpiredOperation = {
  id: string;
  status: string;
  fencing_token: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  workflow_run_id: string | null;
  generation_run_id: string | null;
  creative_id: string | null;
  queue_id: string | null;
  updated_at: string;
};

type WatchdogAction = {
  operationId: string;
  action: 'requeued' | 'failed' | 'ignored' | 'error';
  reason: string;
  workflowRunId: string | null;
};

function isRecentRetryableEvent(event: Record<string, unknown> | null, now: number): boolean {
  if (event?.status !== 'retryable_failure') return false;
  const occurredAt = typeof event.occurred_at === 'string' ? Date.parse(event.occurred_at) : Number.NaN;
  return Number.isFinite(occurredAt) && occurredAt >= now - 30 * 60_000;
}

export async function recoverExpiredBlogContentOperationsV4(input: {
  supabase: SupabaseClient;
  limit?: number;
  now?: Date;
}): Promise<{
  checked: number;
  reservationExpired: number;
  actions: WatchdogAction[];
}> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const { data, error } = await input.supabase
    .from('blog_content_operations')
    .select('id,status,fencing_token,lease_owner,lease_expires_at,workflow_run_id,generation_run_id,creative_id,queue_id,updated_at')
    .eq('status', 'running')
    .or(`lease_expires_at.lt.${now.toISOString()},lease_expires_at.is.null`)
    .order('lease_expires_at', { ascending: true })
    .limit(Math.max(1, Math.min(20, Math.trunc(input.limit ?? 20))));
  if (error) throw new Error(`blog_content_watchdog_operation_read_failed:${error.message}`);

  const reservationResult = await input.supabase.rpc('expire_stale_ai_reservations_v1', {
    p_older_than_minutes: 30,
  });
  const reservationExpired = reservationResult.error ? 0 : Number(reservationResult.data ?? 0);
  const actions: WatchdogAction[] = [];

  for (const operation of (data ?? []) as ExpiredOperation[]) {
    const { data: latestEvent, error: eventError } = await input.supabase
      .from('blog_content_stage_events')
      .select('event_key,status,failure_code,evidence,occurred_at')
      .eq('operation_id', operation.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) {
      actions.push({
        operationId: operation.id,
        action: 'error',
        reason: `stage_event_read_failed:${eventError.message}`,
        workflowRunId: operation.workflow_run_id,
      });
      continue;
    }

    if (operation.workflow_run_id) {
      await getRun(operation.workflow_run_id).cancel().catch(() => undefined);
    }

    try {
      if (isRecentRetryableEvent(latestEvent as Record<string, unknown> | null, nowMs)) {
        await requeueBlogContentOperationV4({
          supabase: input.supabase,
          operationId: operation.id,
        });
        actions.push({
          operationId: operation.id,
          action: 'requeued',
          reason: 'recent_retryable_event',
          workflowRunId: operation.workflow_run_id,
        });
        continue;
      }

      if (!operation.lease_owner) {
        actions.push({
          operationId: operation.id,
          action: 'ignored',
          reason: 'expired_operation_lease_owner_missing',
          workflowRunId: operation.workflow_run_id,
        });
        continue;
      }

      await terminalizeBlogContentOperationV4({
        supabase: input.supabase,
        operationId: operation.id,
        fencingToken: Number(operation.fencing_token),
        leaseOwner: operation.lease_owner,
        status: 'failed',
        stage: 'failed',
        eventKey: `watchdog:terminalize:v1:${operation.fencing_token}`,
        failureCode: latestEvent?.failure_code
          ? String(latestEvent.failure_code)
          : 'blog_content_operation_watchdog_expired',
        generationRunId: operation.generation_run_id,
        creativeId: operation.creative_id,
        evidence: {
          watchdog: true,
          workflowRunId: operation.workflow_run_id,
          queueId: operation.queue_id,
          latestEvent: latestEvent ?? null,
          aiReservationReconciled: !reservationResult.error,
        },
      });
      actions.push({
        operationId: operation.id,
        action: 'failed',
        reason: 'expired_without_recent_retryable_event',
        workflowRunId: operation.workflow_run_id,
      });
    } catch (operationError) {
      actions.push({
        operationId: operation.id,
        action: 'error',
        reason: operationError instanceof Error ? operationError.message : String(operationError),
        workflowRunId: operation.workflow_run_id,
      });
    }
  }

  return {
    checked: (data ?? []).length,
    reservationExpired,
    actions,
  };
}
