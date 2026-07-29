export const DEFAULT_AGENT_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REQUEST_SCOPED_AGENT_TASK_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_TRACE_MAX_OPEN_MS = 24 * 60 * 60 * 1000;

const REQUEST_SCOPED_SOURCES = new Set([
  'jarvis_stream',
  'jarvis_v1',
  'qa_chat',
]);

const ACTIVE_TASK_STATUSES = new Set([
  'queued',
  'running',
  'frozen',
  'resumed',
]);

export interface AgentLifecycleApproval {
  id: string;
  task_id: string;
  status: string;
  requested_at: string | null;
  created_at?: string | null;
  expires_at: string | null;
}
export interface AgentLifecycleTask {
  id: string;
  status: string;
  source: string;
  updated_at: string;
  expires_at: string | null;
}

export interface AgentLifecycleTrace {
  id: string;
  started_at: string;
  ended_at: string | null;
}

export interface AgentHousekeepingPlan {
  approvalIds: string[];
  taskIds: string[];
  traceIds: string[];
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveAgentApprovalExpiry(
  expiresAt: string | null | undefined,
  now = new Date(),
): string {
  if (expiresAt) {
    const parsed = timestamp(expiresAt);
    if (parsed == null) {
      throw new Error('유효하지 않은 승인 만료시각입니다.');
    }
    return new Date(parsed).toISOString();
  }

  return new Date(now.getTime() + DEFAULT_AGENT_APPROVAL_TTL_MS).toISOString();
}

export function buildAgentHousekeepingPlan(params: {
  approvals: AgentLifecycleApproval[];
  tasks: AgentLifecycleTask[];
  traces: AgentLifecycleTrace[];
  now?: Date;
}): AgentHousekeepingPlan {
  const nowMs = (params.now ?? new Date()).getTime();
  const legacyApprovalCutoff = nowMs - DEFAULT_AGENT_APPROVAL_TTL_MS;
  const requestTaskCutoff = nowMs - REQUEST_SCOPED_AGENT_TASK_TTL_MS;
  const traceCutoff = nowMs - AGENT_TRACE_MAX_OPEN_MS;

  const approvalIds = new Set<string>();
  const approvalTaskIds = new Set<string>();

  for (const approval of params.approvals) {
    if (approval.status !== 'pending') continue;

    const explicitExpiry = timestamp(approval.expires_at);
    const requestedAt = timestamp(approval.requested_at ?? approval.created_at);
    const isExpired = explicitExpiry != null
      ? explicitExpiry <= nowMs
      : requestedAt != null && requestedAt <= legacyApprovalCutoff;

    if (isExpired) {
      approvalIds.add(approval.id);
      approvalTaskIds.add(approval.task_id);
    }
  }

  const taskIds = new Set<string>();
  for (const task of params.tasks) {
    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue;

    const explicitExpiry = timestamp(task.expires_at);
    const updatedAt = timestamp(task.updated_at);
    const approvalExpired = task.status === 'frozen' && approvalTaskIds.has(task.id);
    const taskExpired = explicitExpiry != null && explicitExpiry <= nowMs;
    const requestStale = REQUEST_SCOPED_SOURCES.has(task.source)
      && updatedAt != null
      && updatedAt <= requestTaskCutoff;

    if (approvalExpired || taskExpired || requestStale) {
      taskIds.add(task.id);
    }
  }

  const traceIds = new Set<string>();
  for (const trace of params.traces) {
    const startedAt = timestamp(trace.started_at);
    if (trace.ended_at == null && startedAt != null && startedAt <= traceCutoff) {
      traceIds.add(trace.id);
    }
  }

  return {
    approvalIds: Array.from(approvalIds),
    taskIds: Array.from(taskIds),
    traceIds: Array.from(traceIds),
  };
}
