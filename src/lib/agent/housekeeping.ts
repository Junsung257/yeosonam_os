import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buildAgentHousekeepingPlan,
  type AgentLifecycleApproval,
  type AgentLifecycleTask,
  type AgentLifecycleTrace,
} from '@/lib/agent/lifecycle-policy';

const HOUSEKEEPING_SCAN_LIMIT = 1_000;
const HOUSEKEEPING_ACTOR = 'system:agent-executor';

export interface AgentHousekeepingResult {
  scanned: {
    approvals: number;
    tasks: number;
    traces: number;
  };
  expired: {
    approvals: number;
    tasks: number;
    traces: number;
  };
}
async function updateExpiredApprovals(
  client: SupabaseClient,
  ids: string[],
  now: string,
) {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('agent_approvals')
    .update({
      status: 'expired',
      reviewed_at: now,
      reviewed_by: HOUSEKEEPING_ACTOR,
      updated_at: now,
    })
    .in('id', ids)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  return data ?? [];
}

async function updateExpiredTasks(
  client: SupabaseClient,
  ids: string[],
  now: string,
) {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('agent_tasks')
    .update({
      status: 'expired',
      last_error: 'agent_lifecycle_expired',
      completed_at: now,
      updated_at: now,
    })
    .in('id', ids)
    .in('status', ['queued', 'running', 'frozen', 'resumed'])
    .select('id');
  if (error) throw error;
  return data ?? [];
}

async function closeStaleTraces(
  client: SupabaseClient,
  ids: string[],
  now: string,
) {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('agent_trace_spans')
    .update({ ended_at: now })
    .in('id', ids)
    .is('ended_at', null)
    .select('id');
  if (error) throw error;
  return data ?? [];
}

export async function runAgentHousekeeping(params?: {
  client?: SupabaseClient;
  now?: Date;
}): Promise<AgentHousekeepingResult> {
  const client = params?.client ?? supabaseAdmin;
  const nowDate = params?.now ?? new Date();
  const now = nowDate.toISOString();

  const [
    { data: approvalData, error: approvalError },
    { data: taskData, error: taskError },
    { data: traceData, error: traceError },
  ] = await Promise.all([
    client
      .from('agent_approvals')
      .select('id, task_id, status, requested_at, created_at, expires_at')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(HOUSEKEEPING_SCAN_LIMIT),
    client
      .from('agent_tasks')
      .select('id, status, source, updated_at, expires_at')
      .in('status', ['queued', 'running', 'frozen', 'resumed'])
      .order('updated_at', { ascending: true })
      .limit(HOUSEKEEPING_SCAN_LIMIT),
    client
      .from('agent_trace_spans')
      .select('id, started_at, ended_at')
      .is('ended_at', null)
      .order('started_at', { ascending: true })
      .limit(HOUSEKEEPING_SCAN_LIMIT),
  ]);

  if (approvalError) throw approvalError;
  if (taskError) throw taskError;
  if (traceError) throw traceError;

  const approvals = (approvalData ?? []) as AgentLifecycleApproval[];
  const tasks = (taskData ?? []) as AgentLifecycleTask[];
  const traces = (traceData ?? []) as AgentLifecycleTrace[];
  const plan = buildAgentHousekeepingPlan({
    approvals,
    tasks,
    traces,
    now: nowDate,
  });

  const [expiredApprovals, expiredTasks, closedTraces] = await Promise.all([
    updateExpiredApprovals(client, plan.approvalIds, now),
    updateExpiredTasks(client, plan.taskIds, now),
    closeStaleTraces(client, plan.traceIds, now),
  ]);

  return {
    scanned: {
      approvals: approvals.length,
      tasks: tasks.length,
      traces: traces.length,
    },
    expired: {
      approvals: expiredApprovals.length,
      tasks: expiredTasks.length,
      traces: closedTraces.length,
    },
  };
}
