import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

export type AgentOfficeTaskStatus =
  | 'queued'
  | 'running'
  | 'frozen'
  | 'resumed'
  | 'done'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type AgentOfficeRisk = 'low' | 'medium' | 'high' | 'critical';
export type AgentOfficeWorkroomStatus = 'queued' | 'running' | 'blocked' | 'stale' | 'failed' | 'done' | 'closed';

export interface AgentOfficeTaskRow {
  id: string;
  correlation_id: string;
  source: string;
  agent_type: string;
  specialist_id: string | null;
  risk_level: string;
  status: string;
  retry_count: number | null;
  max_retries: number | null;
  last_error: string | null;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  task_context: Record<string, unknown> | null;
}

export interface AgentOfficeApprovalRow {
  id: string;
  task_id: string;
  status: string;
  reason: string | null;
  requested_by: string;
  reviewed_by: string | null;
  requested_at: string;
  reviewed_at: string | null;
  expires_at: string | null;
}

export interface AgentOfficeIncidentRow {
  id: string;
  correlation_id: string | null;
  task_id: string | null;
  severity: string;
  category: string;
  message: string;
  detected_by: string;
  created_at: string;
}

export interface AgentOfficeTraceRow {
  id: string;
  trace_id: string;
  task_id: string | null;
  span_name: string;
  agent_type: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface AgentOfficeTimelineEvent {
  id: string;
  type: 'task' | 'approval' | 'incident' | 'trace';
  occurredAt: string;
  label: string;
  detail: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
}

export interface AgentOfficeResearchSignalSummary {
  title: string;
  excerpt: string;
  sourceUrl: string;
  sourceHostname: string;
  sourcePlatform: string;
  collectedAt: string;
  collector: string;
  collectorVersion: string;
  evidenceClass: string;
  confidence: number;
  disposition: 'review_required';
  publicationAllowed: false;
  productFactAllowed: false;
}

export interface AgentOfficeTaskSummary {
  id: string;
  agentType: string;
  specialistId: string | null;
  roleLabel: string;
  source: string;
  status: AgentOfficeTaskStatus;
  risk: AgentOfficeRisk;
  retryCount: number;
  maxRetries: number;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  researchSignal: AgentOfficeResearchSignalSummary | null;
}

export interface AgentOfficeWorkroom {
  correlationId: string;
  title: string;
  status: AgentOfficeWorkroomStatus;
  risk: AgentOfficeRisk;
  createdAt: string;
  updatedAt: string;
  progress: {
    done: number;
    total: number;
    active: number;
  };
  pendingApprovals: number;
  incidentCount: number;
  criticalIncidentCount: number;
  roleLabels: string[];
  isMultiAgent: boolean;
  tasks: AgentOfficeTaskSummary[];
  timeline: AgentOfficeTimelineEvent[];
}

export interface AgentOfficeSnapshot {
  generatedAt: string;
  metrics: {
    activeWorkrooms: number;
    staleWorkrooms: number;
    pendingApprovals: number;
    overdueApprovals: number;
    failedTasks24h: number;
    completionRate7d: number | null;
    terminalTasks7d: number;
    multiAgentWorkrooms7d: number;
    p95TraceDurationMs: number | null;
  };
  operatingModel: {
    execution: 'durable_backend';
    thread: 'correlation_evidence_timeline';
    controlSurface: 'admin_dashboard';
    externalMutation: 'approval_required';
    autonomousLoop: false;
    recommendedParallelWorkers: number;
  };
  sourceCounts: {
    tasks: number;
    approvals: number;
    incidents: number;
    traces: number;
  };
  sourceIssues: string[];
  freshness: {
    latestTaskUpdatedAt: string | null;
    latestTaskAgeHours: number | null;
    isStale: boolean;
  };
  workrooms: AgentOfficeWorkroom[];
  approvals: Array<Omit<AgentOfficeApprovalRow, 'reason'> & {
    safeReason: string | null;
    isOverdue: boolean;
  }>;
  incidents: Array<Omit<AgentOfficeIncidentRow, 'message'> & { safeMessage: string }>;
}

export interface BuildAgentOfficeSnapshotInput {
  generatedAt?: string;
  tasks: AgentOfficeTaskRow[];
  approvals: AgentOfficeApprovalRow[];
  incidents: AgentOfficeIncidentRow[];
  traces: AgentOfficeTraceRow[];
  sourceIssues?: string[];
  maxWorkrooms?: number;
}

const ACTIVE_TASK_STATUSES = new Set<AgentOfficeTaskStatus>(['queued', 'running', 'frozen', 'resumed']);
const ACTIVE_WORKROOM_STALE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_APPROVAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_STATUSES = new Set<AgentOfficeTaskStatus>([
  'queued',
  'running',
  'frozen',
  'resumed',
  'done',
  'failed',
  'expired',
  'cancelled',
]);
const RISKS = new Set<AgentOfficeRisk>(['low', 'medium', 'high', 'critical']);
const RISK_RANK: Record<AgentOfficeRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const AGENT_LABELS: Record<string, string> = {
  operations: '운영',
  products: '상품',
  finance: '재무',
  marketing: '마케팅',
  sales: '영업',
  system: '시스템',
  concierge: '컨시어지',
  booking: '예약',
  affiliate: '제휴',
};

const SOURCE_LABELS: Record<string, string> = {
  jarvis_stream: '자비스 실행',
  jarvis_v1: '자비스 작업',
  qa_chat: '고객 QA 작업',
  cron: '예약 작업',
  manual: '수동 작업',
  research_node: '외부 조사 신호',
};

function asTaskStatus(value: string): AgentOfficeTaskStatus {
  return TASK_STATUSES.has(value as AgentOfficeTaskStatus)
    ? (value as AgentOfficeTaskStatus)
    : 'failed';
}

function asRisk(value: string): AgentOfficeRisk {
  return RISKS.has(value as AgentOfficeRisk) ? (value as AgentOfficeRisk) : 'high';
}

function safeText(value: unknown, maxLength = 180): string | null {
  return typeof value === 'string' ? safeRawTextExcerpt(value, maxLength) : null;
}

function humanizeTechnicalLabel(value: string): string {
  return /^[a-z0-9_.-]+$/i.test(value)
    ? value.replaceAll('_', ' ').replaceAll('.', ' · ')
    : value;
}

function roleLabel(task: AgentOfficeTaskRow): string {
  const specialist = safeText(task.specialist_id, 80);
  if (specialist) return humanizeTechnicalLabel(specialist);
  return AGENT_LABELS[task.agent_type] ?? task.agent_type;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function researchSignalSummary(task: AgentOfficeTaskRow): AgentOfficeResearchSignalSummary | null {
  if (task.source !== 'research_node') return null;
  const context = asRecord(task.task_context);
  const signal = asRecord(context?.signal);
  if (
    context?.schema !== 'ResearchSignalEnvelopeV1'
    || context.disposition !== 'review_required'
    || context.publicationAllowed !== false
    || context.productFactAllowed !== false
    || !signal
  ) return null;

  const title = safeText(signal.title, 160);
  const excerpt = safeText(signal.excerpt, 480);
  const sourcePlatform = safeText(signal.sourcePlatform, 40);
  const collector = safeText(signal.collector, 40);
  const collectorVersion = safeText(signal.collectorVersion, 80);
  const evidenceClass = safeText(signal.evidenceClass, 60);
  const collectedAt = safeText(signal.collectedAt, 40);
  const confidence = typeof signal.confidence === 'number' && Number.isFinite(signal.confidence)
    ? Math.min(1, Math.max(0, signal.confidence))
    : null;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(signal.sourceUrl ?? ''));
  } catch {
    return null;
  }
  if (
    !title
    || !excerpt
    || !sourcePlatform
    || !collector
    || !collectorVersion
    || !evidenceClass
    || !collectedAt
    || !Number.isFinite(Date.parse(collectedAt))
    || confidence === null
    || sourceUrl.protocol !== 'https:'
    || sourceUrl.username
    || sourceUrl.password
  ) return null;

  return {
    title,
    excerpt,
    sourceUrl: sourceUrl.toString(),
    sourceHostname: sourceUrl.hostname,
    sourcePlatform,
    collectedAt,
    collector,
    collectorVersion,
    evidenceClass,
    confidence,
    disposition: 'review_required',
    publicationAllowed: false,
    productFactAllowed: false,
  };
}

function workroomTitle(tasks: AgentOfficeTaskRow[]): string {
  for (const task of tasks) {
    const researchSignal = researchSignalSummary(task);
    if (researchSignal) return researchSignal.title;
    const context = task.task_context ?? {};
    const title =
      safeText(context.officeObjective, 120)
      ?? safeText(context.normalizedIntent, 120)
      ?? safeText(context.intent, 120);
    if (title) return humanizeTechnicalLabel(title);
  }

  const first = tasks[0];
  if (!first) return '에이전트 작업';
  return SOURCE_LABELS[first.source] ?? `${AGENT_LABELS[first.agent_type] ?? first.agent_type} 작업`;
}

function deriveWorkroomStatus(
  tasks: AgentOfficeTaskRow[],
  updatedAt: string,
  now: number,
): AgentOfficeWorkroomStatus {
  const statuses = tasks.map((task) => asTaskStatus(task.status));
  if (statuses.includes('failed')) return 'failed';
  if (
    statuses.some((status) => ACTIVE_TASK_STATUSES.has(status))
    && now - timeValue(updatedAt) > ACTIVE_WORKROOM_STALE_MS
  ) {
    return 'stale';
  }
  if (statuses.includes('frozen')) return 'blocked';
  if (statuses.includes('running') || statuses.includes('resumed')) return 'running';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.some((status) => status === 'done')) return 'done';
  return 'closed';
}

function deriveRisk(tasks: AgentOfficeTaskRow[]): AgentOfficeRisk {
  return tasks.reduce<AgentOfficeRisk>((highest, task) => {
    const risk = asRisk(task.risk_level);
    return RISK_RANK[risk] > RISK_RANK[highest] ? risk : highest;
  }, 'low');
}

function timeValue(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

export function isAgentApprovalOverdue(
  approval: Pick<AgentOfficeApprovalRow, 'status' | 'requested_at' | 'expires_at'>,
  now = Date.now(),
): boolean {
  if (approval.status !== 'pending') return false;
  const expiresAt = timeValue(approval.expires_at);
  if (expiresAt > 0) return expiresAt <= now;
  const requestedAt = timeValue(approval.requested_at);
  return requestedAt <= 0 || now - requestedAt > DEFAULT_APPROVAL_MAX_AGE_MS;
}

function taskTone(status: AgentOfficeTaskStatus): AgentOfficeTimelineEvent['tone'] {
  if (status === 'done') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'frozen' || status === 'expired') return 'warning';
  if (status === 'running' || status === 'resumed') return 'info';
  return 'neutral';
}

function buildTimeline(
  tasks: AgentOfficeTaskRow[],
  approvals: AgentOfficeApprovalRow[],
  incidents: AgentOfficeIncidentRow[],
  traces: AgentOfficeTraceRow[],
): AgentOfficeTimelineEvent[] {
  const events: AgentOfficeTimelineEvent[] = [];

  for (const task of tasks) {
    const status = asTaskStatus(task.status);
    const error = safeText(task.last_error, 180);
    events.push({
      id: `task:${task.id}`,
      type: 'task',
      occurredAt: task.updated_at || task.created_at,
      label: `${roleLabel(task)} · ${status}`,
      detail: error ?? `${task.source}에서 생성된 작업`,
      tone: taskTone(status),
    });
  }

  for (const approval of approvals) {
    const reason = safeText(approval.reason, 180);
    events.push({
      id: `approval:${approval.id}`,
      type: 'approval',
      occurredAt: approval.reviewed_at ?? approval.requested_at,
      label: `승인 · ${approval.status}`,
      detail: reason ?? (approval.status === 'pending' ? '운영자 결정을 기다리고 있습니다.' : '승인 결정이 기록됐습니다.'),
      tone: approval.status === 'approved'
        ? 'success'
        : approval.status === 'pending'
          ? 'warning'
          : 'danger',
    });
  }

  for (const incident of incidents) {
    events.push({
      id: `incident:${incident.id}`,
      type: 'incident',
      occurredAt: incident.created_at,
      label: `${incident.category} · ${incident.severity}`,
      detail: safeText(incident.message, 180) ?? '세부 메시지 없음',
      tone: incident.severity === 'critical' || incident.severity === 'error' ? 'danger' : 'warning',
    });
  }

  for (const trace of traces) {
    events.push({
      id: `trace:${trace.id}`,
      type: 'trace',
      occurredAt: trace.ended_at ?? trace.started_at,
      label: `trace · ${trace.span_name}`,
      detail: trace.duration_ms == null
        ? '종료 시간이 기록되지 않았습니다.'
        : `${trace.duration_ms.toLocaleString('ko-KR')}ms`,
      tone: trace.ended_at ? 'neutral' : 'info',
    });
  }

  return events
    .sort((a, b) => timeValue(b.occurredAt) - timeValue(a.occurredAt))
    .slice(0, 80);
}

export function buildAgentOfficeSnapshot(input: BuildAgentOfficeSnapshotInput): AgentOfficeSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const now = timeValue(generatedAt) || Date.now();
  const day = 24 * 60 * 60 * 1000;
  const maxWorkrooms = Math.min(50, Math.max(1, input.maxWorkrooms ?? 24));
  const grouped = new Map<string, AgentOfficeTaskRow[]>();

  for (const task of input.tasks) {
    const key = task.correlation_id || task.id;
    const current = grouped.get(key) ?? [];
    current.push(task);
    grouped.set(key, current);
  }

  const workrooms = Array.from(grouped.entries()).map(([correlationId, tasks]) => {
    const taskIds = new Set(tasks.map((task) => task.id));
    const approvals = input.approvals.filter((approval) => taskIds.has(approval.task_id));
    const incidents = input.incidents.filter((incident) =>
      incident.correlation_id === correlationId || (!!incident.task_id && taskIds.has(incident.task_id)));
    const traces = input.traces.filter((trace) => !!trace.task_id && taskIds.has(trace.task_id));
    const labels = Array.from(new Set(tasks.map(roleLabel)));
    const done = tasks.filter((task) => asTaskStatus(task.status) === 'done').length;
    const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(asTaskStatus(task.status))).length;
    const updatedAt = tasks.reduce(
      (latest, task) => timeValue(task.updated_at) > timeValue(latest) ? task.updated_at : latest,
      tasks[0]?.updated_at ?? generatedAt,
    );

    return {
      correlationId,
      title: workroomTitle(tasks),
      status: deriveWorkroomStatus(tasks, updatedAt, now),
      risk: deriveRisk(tasks),
      createdAt: tasks.reduce(
        (earliest, task) => timeValue(task.created_at) < timeValue(earliest) ? task.created_at : earliest,
        tasks[0]?.created_at ?? generatedAt,
      ),
      updatedAt,
      progress: { done, total: tasks.length, active },
      pendingApprovals: approvals.filter((approval) => approval.status === 'pending').length,
      incidentCount: incidents.length,
      criticalIncidentCount: incidents.filter((incident) => incident.severity === 'critical').length,
      roleLabels: labels,
      isMultiAgent: tasks.length > 1 && labels.length > 1,
      tasks: tasks
        .sort((a, b) => timeValue(b.updated_at) - timeValue(a.updated_at))
        .map((task) => ({
          id: task.id,
          agentType: task.agent_type,
          specialistId: task.specialist_id,
          roleLabel: roleLabel(task),
          source: task.source,
          status: asTaskStatus(task.status),
          risk: asRisk(task.risk_level),
          retryCount: task.retry_count ?? 0,
          maxRetries: task.max_retries ?? 0,
          assignedTo: task.assigned_to,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          lastError: safeText(task.last_error, 180),
          researchSignal: researchSignalSummary(task),
        })),
      timeline: buildTimeline(tasks, approvals, incidents, traces),
    } satisfies AgentOfficeWorkroom;
  })
    .sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))
    .slice(0, maxWorkrooms);

  const tasks7d = input.tasks.filter((task) => timeValue(task.updated_at) >= now - (7 * day));
  const terminal7d = tasks7d.filter((task) => ['done', 'failed'].includes(asTaskStatus(task.status)));
  const done7d = terminal7d.filter((task) => asTaskStatus(task.status) === 'done').length;
  const latestTaskUpdatedAt = input.tasks.reduce<string | null>(
    (latest, task) => !latest || timeValue(task.updated_at) > timeValue(latest) ? task.updated_at : latest,
    null,
  );
  const latestTaskAgeHours = latestTaskUpdatedAt
    ? Math.max(0, Math.round(((now - timeValue(latestTaskUpdatedAt)) / (60 * 60 * 1000)) * 10) / 10)
    : null;
  const approvals = input.approvals.map(({ reason, ...approval }) => ({
    ...approval,
    safeReason: safeText(reason, 240),
    isOverdue: isAgentApprovalOverdue(approval, now),
  }));

  return {
    generatedAt,
    metrics: {
      activeWorkrooms: workrooms.filter((workroom) =>
        ['queued', 'running', 'blocked'].includes(workroom.status)).length,
      staleWorkrooms: workrooms.filter((workroom) => workroom.status === 'stale').length,
      pendingApprovals: input.approvals.filter((approval) => approval.status === 'pending').length,
      overdueApprovals: approvals.filter((approval) => approval.isOverdue).length,
      failedTasks24h: input.tasks.filter((task) =>
        asTaskStatus(task.status) === 'failed' && timeValue(task.updated_at) >= now - day).length,
      completionRate7d: terminal7d.length > 0 ? Math.round((done7d / terminal7d.length) * 100) : null,
      terminalTasks7d: terminal7d.length,
      multiAgentWorkrooms7d: workrooms.filter((workroom) =>
        workroom.isMultiAgent && timeValue(workroom.updatedAt) >= now - (7 * day)).length,
      p95TraceDurationMs: percentile95(input.traces
        .map((trace) => trace.duration_ms)
        .filter((duration): duration is number => typeof duration === 'number' && duration >= 0)),
    },
    operatingModel: {
      execution: 'durable_backend',
      thread: 'correlation_evidence_timeline',
      controlSurface: 'admin_dashboard',
      externalMutation: 'approval_required',
      autonomousLoop: false,
      recommendedParallelWorkers: 3,
    },
    sourceCounts: {
      tasks: input.tasks.length,
      approvals: input.approvals.length,
      incidents: input.incidents.length,
      traces: input.traces.length,
    },
    sourceIssues: Array.from(new Set(input.sourceIssues ?? [])),
    freshness: {
      latestTaskUpdatedAt,
      latestTaskAgeHours,
      isStale: latestTaskAgeHours == null || latestTaskAgeHours > 24,
    },
    workrooms,
    approvals,
    incidents: input.incidents.map(({ message, ...incident }) => ({
      ...incident,
      safeMessage: safeText(message, 240) ?? '세부 메시지 없음',
    })),
  };
}
