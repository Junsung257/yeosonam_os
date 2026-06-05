export type TraceTaskStatus = 'queued' | 'running' | 'frozen' | 'resumed' | 'done' | 'failed' | 'expired' | 'cancelled';
export type TraceRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TraceSpanSnapshot {
  id: string;
  traceId: string;
  spanName: string;
  sessionId?: string | null;
  taskId?: string | null;
  agentType?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

export interface TraceTaskSnapshot {
  id: string;
  status: TraceTaskStatus;
  riskLevel: TraceRiskLevel;
  agentType: string;
  specialistId?: string | null;
  approvedBy?: string | null;
  lastError?: string | null;
}

export interface TraceIncidentSnapshot {
  severity: 'info' | 'warn' | 'error' | 'critical';
  category: string;
  taskId?: string | null;
  traceId?: string | null;
}

export interface TraceGradeInput {
  traceId: string;
  task?: TraceTaskSnapshot | null;
  spans: TraceSpanSnapshot[];
  incidents?: TraceIncidentSnapshot[];
}

export interface TraceGradeResult {
  traceId: string;
  passed: boolean;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    severity: 'warn' | 'fail';
    message: string;
  }>;
}

export interface TraceGradeSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
  results: TraceGradeResult[];
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function addCheck(
  checks: TraceGradeResult['checks'],
  name: string,
  passed: boolean,
  severity: 'warn' | 'fail',
  message: string,
) {
  checks.push({ name, passed, severity, message });
}

function spanMetadataValue(spans: TraceSpanSnapshot[], key: string): unknown {
  for (const span of spans) {
    if (span.metadata && key in span.metadata) return span.metadata[key];
  }
  return undefined;
}

export function gradeJarvisTrace(input: TraceGradeInput): TraceGradeResult {
  const checks: TraceGradeResult['checks'] = [];
  const rootSpan = input.spans.find((span) => span.spanName === 'jarvis_stream_total')
    ?? input.spans[0]
    ?? null;
  const terminalTask = input.task?.status === 'done'
    || input.task?.status === 'failed'
    || input.task?.status === 'cancelled'
    || input.task?.status === 'expired';
  const hasBlockingIncident = (input.incidents ?? [])
    .some((incident) => incident.severity === 'error' || incident.severity === 'critical');

  addCheck(checks, 'has_root_span', !!rootSpan, 'fail', 'trace must include a root span');
  addCheck(checks, 'span_has_session', !!rootSpan && hasValue(rootSpan.sessionId), 'fail', 'root span must include sessionId');
  addCheck(checks, 'span_has_task', !!rootSpan && hasValue(rootSpan.taskId), 'fail', 'root span must include taskId');
  addCheck(checks, 'span_closed', !!rootSpan && hasValue(rootSpan.endedAt) && typeof rootSpan.durationMs === 'number', 'fail', 'root span must be closed with duration');
  addCheck(checks, 'task_terminal', !!input.task && terminalTask, 'fail', 'task must reach a terminal status for completed traces');
  addCheck(checks, 'agent_recorded', !!rootSpan && hasValue(rootSpan.agentType), 'fail', 'root span must record agentType');
  addCheck(checks, 'specialist_recorded', hasValue(input.task?.specialistId) || hasValue(spanMetadataValue(input.spans, 'specialistId')), 'warn', 'trace should retain specialistId');
  addCheck(checks, 'latency_recorded', typeof spanMetadataValue(input.spans, 'totalLatencyMs') === 'number' || typeof rootSpan?.durationMs === 'number', 'warn', 'trace should include latency metadata');
  addCheck(checks, 'ttft_recorded', typeof spanMetadataValue(input.spans, 'ttftMs') === 'number' || input.task?.status === 'failed', 'warn', 'streaming traces should include TTFT unless failed before first token');
  addCheck(checks, 'no_error_incident', !hasBlockingIncident, 'fail', 'trace must not have error/critical incidents');

  if (input.task?.riskLevel === 'high' || input.task?.riskLevel === 'critical') {
    addCheck(checks, 'high_risk_human_review', hasValue(input.task.approvedBy) || input.task.status === 'cancelled', 'fail', 'high/critical risk traces require approval or cancellation');
  }

  const failedChecks = checks.filter((check) => !check.passed);
  const failCount = failedChecks.filter((check) => check.severity === 'fail').length;
  const warnCount = failedChecks.filter((check) => check.severity === 'warn').length;
  const score = Math.max(0, Math.round(100 - failCount * 20 - warnCount * 5));

  return {
    traceId: input.traceId,
    passed: failCount === 0,
    score,
    checks,
  };
}

export function gradeJarvisTraceSet(inputs: TraceGradeInput[]): TraceGradeSummary {
  const results = inputs.map(gradeJarvisTrace);
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const averageScore = total === 0
    ? 0
    : results.reduce((sum, result) => sum + result.score, 0) / total;

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : passed / total,
    averageScore,
    results,
  };
}
