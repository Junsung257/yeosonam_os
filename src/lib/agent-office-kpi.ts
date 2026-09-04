import { z } from 'zod';

export const AGENT_OFFICE_KPI_CALCULATION_VERSION = 'agent-office-kpi-v1' as const;
export const AGENT_OFFICE_KPI_SCHEMA_VERSION = 'agent-office-kpi-snapshot-v1' as const;

export const AGENT_OFFICE_KPI_WINDOWS = ['24h', '7d', '30d'] as const;
export type AgentOfficeKpiWindow = typeof AGENT_OFFICE_KPI_WINDOWS[number];

export const AGENT_OFFICE_KPI_DEFINITIONS = Object.freeze([
  {
    key: 'agent.tasks.completed',
    label: '완료 작업',
    description: '기간 안에 terminal done으로 기록된 업무 수',
    unit: 'count',
  },
  {
    key: 'agent.tasks.failed',
    label: '실패 작업',
    description: '기간 안에 실패로 기록된 업무 수',
    unit: 'count',
  },
  {
    key: 'agent.tasks.active',
    label: '현재 활성 작업',
    description: '현재 queued·running·frozen·resumed 상태인 업무 수',
    unit: 'count',
  },
  {
    key: 'agent.approvals.pending',
    label: '승인 대기',
    description: '현재 pending 상태인 승인 요청 수',
    unit: 'count',
  },
  {
    key: 'agent.approvals.overdue',
    label: '기한 경과 승인',
    description: '명시된 만료 또는 기본 7일 기한을 넘긴 승인 요청 수',
    unit: 'count',
  },
  {
    key: 'agent.incidents.critical',
    label: '긴급 사고',
    description: '기간 안에 기록된 critical incident 수',
    unit: 'count',
  },
  {
    key: 'agent.trace.p95_duration_ms',
    label: 'Trace P95',
    description: '기간 안에 종료된 trace duration의 95백분위',
    unit: 'milliseconds',
  },
  {
    key: 'agent.workrooms.multi_agent',
    label: '다중 역할 작업실',
    description: '기간 안에 서로 다른 역할이 참여한 correlation 작업실 수',
    unit: 'count',
  },
] as const);

const KpiMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  unit: z.enum(['count', 'milliseconds']),
  value: z.number().finite().nonnegative().nullable(),
  status: z.enum(['available', 'no_data', 'unavailable']),
  source: z.literal('public.get_agent_office_kpi_v1'),
}).strict();

export const AgentOfficeKpiSnapshotSchema = z.object({
  schemaVersion: z.literal(AGENT_OFFICE_KPI_SCHEMA_VERSION),
  calculationVersion: z.literal(AGENT_OFFICE_KPI_CALCULATION_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  window: z.object({
    key: z.enum(AGENT_OFFICE_KPI_WINDOWS),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  }).strict(),
  freshness: z.object({
    sourceUpdatedAt: z.string().datetime({ offset: true }).nullable(),
    measuredAt: z.string().datetime({ offset: true }),
    isStale: z.boolean(),
  }).strict(),
  status: z.enum(['available', 'no_data', 'unavailable']),
  metrics: z.array(KpiMetricSchema).length(AGENT_OFFICE_KPI_DEFINITIONS.length),
}).strict();

export type AgentOfficeKpiSnapshot = z.infer<typeof AgentOfficeKpiSnapshotSchema>;
export type AgentOfficeKpiMetric = z.infer<typeof KpiMetricSchema>;

export type AgentOfficeKpiRpcRow = {
  metric_key: string;
  value: number | string | null;
  source_updated_at: string | null;
};

export function windowToDurationMs(window: AgentOfficeKpiWindow): number {
  if (window === '24h') return 24 * 60 * 60 * 1_000;
  if (window === '30d') return 30 * 24 * 60 * 60 * 1_000;
  return 7 * 24 * 60 * 60 * 1_000;
}

export function parseAgentOfficeKpiWindow(value: string | null | undefined): AgentOfficeKpiWindow {
  return AGENT_OFFICE_KPI_WINDOWS.includes(value as AgentOfficeKpiWindow)
    ? value as AgentOfficeKpiWindow
    : '7d';
}

function metricValue(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Converts the deliberately small RPC result into the stable operator contract.
 * The RPC is the only source allowed to claim period KPI authority; callers
 * must use `buildUnavailableKpiSnapshot` when the migration is absent.
 */
export function buildAgentOfficeKpiSnapshot(input: {
  window: AgentOfficeKpiWindow;
  from: string;
  to: string;
  generatedAt?: string;
  rows: AgentOfficeKpiRpcRow[];
}): AgentOfficeKpiSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rowByKey = new Map(input.rows.map((row) => [row.metric_key, row]));
  const sourceUpdatedAt = input.rows.reduce<string | null>((latest, row) => {
    if (!row.source_updated_at) return latest;
    if (!latest || Date.parse(row.source_updated_at) > Date.parse(latest)) return row.source_updated_at;
    return latest;
  }, null);
  const metrics = AGENT_OFFICE_KPI_DEFINITIONS.map((definition) => {
    const value = metricValue(rowByKey.get(definition.key)?.value ?? null);
    return {
      ...definition,
      value,
      status: value === null ? 'no_data' as const : 'available' as const,
      source: 'public.get_agent_office_kpi_v1' as const,
    };
  });
  const status = metrics.some((metric) => metric.status === 'available')
    ? 'available'
    : 'no_data';
  return AgentOfficeKpiSnapshotSchema.parse({
    schemaVersion: AGENT_OFFICE_KPI_SCHEMA_VERSION,
    calculationVersion: AGENT_OFFICE_KPI_CALCULATION_VERSION,
    generatedAt,
    window: { key: input.window, from: input.from, to: input.to },
    freshness: {
      sourceUpdatedAt,
      measuredAt: generatedAt,
      isStale: false,
    },
    status,
    metrics,
  });
}

export function buildUnavailableKpiSnapshot(input: {
  window: AgentOfficeKpiWindow;
  from: string;
  to: string;
  reason: 'SUPABASE_NOT_CONFIGURED' | 'KPI_RPC_NOT_APPLIED' | 'KPI_RPC_FAILED';
  generatedAt?: string;
}): {
  schemaVersion: typeof AGENT_OFFICE_KPI_SCHEMA_VERSION;
  calculationVersion: typeof AGENT_OFFICE_KPI_CALCULATION_VERSION;
  generatedAt: string;
  window: { key: AgentOfficeKpiWindow; from: string; to: string };
  freshness: { sourceUpdatedAt: null; measuredAt: string; isStale: true };
  status: 'unavailable';
  reason: typeof input.reason;
  metrics: Array<AgentOfficeKpiMetric & { status: 'unavailable' }>;
} {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: AGENT_OFFICE_KPI_SCHEMA_VERSION,
    calculationVersion: AGENT_OFFICE_KPI_CALCULATION_VERSION,
    generatedAt,
    window: { key: input.window, from: input.from, to: input.to },
    freshness: { sourceUpdatedAt: null, measuredAt: generatedAt, isStale: true },
    status: 'unavailable',
    reason: input.reason,
    metrics: AGENT_OFFICE_KPI_DEFINITIONS.map((definition) => ({
      ...definition,
      value: null,
      status: 'unavailable' as const,
      source: 'public.get_agent_office_kpi_v1' as const,
    })),
  };
}
