import { describe, expect, it } from 'vitest';

import {
  AGENT_OFFICE_KPI_DEFINITIONS,
  AgentOfficeKpiSnapshotSchema,
  buildAgentOfficeKpiSnapshot,
  buildUnavailableKpiSnapshot,
  parseAgentOfficeKpiWindow,
  windowToDurationMs,
} from './agent-office-kpi';

describe('Agent Office KPI contract', () => {
  it('only accepts bounded windows and defaults to the review window', () => {
    expect(parseAgentOfficeKpiWindow('24h')).toBe('24h');
    expect(parseAgentOfficeKpiWindow('30d')).toBe('30d');
    expect(parseAgentOfficeKpiWindow('all')).toBe('7d');
    expect(windowToDurationMs('7d')).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it('builds every registered metric from RPC rows without inventing values', () => {
    const snapshot = buildAgentOfficeKpiSnapshot({
      window: '7d',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
      generatedAt: '2026-09-08T00:00:00.000Z',
      rows: [
        {
          metric_key: 'agent.tasks.completed',
          value: '4',
          source_updated_at: '2026-09-07T23:00:00.000Z',
        },
      ],
    });

    expect(snapshot.status).toBe('available');
    expect(snapshot.metrics).toHaveLength(AGENT_OFFICE_KPI_DEFINITIONS.length);
    expect(snapshot.metrics.find((metric) => metric.key === 'agent.tasks.completed')).toMatchObject({
      value: 4,
      status: 'available',
    });
    expect(snapshot.metrics.find((metric) => metric.key === 'agent.tasks.failed')).toMatchObject({
      value: null,
      status: 'no_data',
    });
    expect(AgentOfficeKpiSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('marks the aggregate unavailable when the Preview/Production RPC is not applied', () => {
    const snapshot = buildUnavailableKpiSnapshot({
      window: '7d',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
      reason: 'KPI_RPC_NOT_APPLIED',
      generatedAt: '2026-09-08T00:00:00.000Z',
    });

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.reason).toBe('KPI_RPC_NOT_APPLIED');
    expect(snapshot.metrics.every((metric) => metric.value === null && metric.status === 'unavailable')).toBe(true);
    expect(snapshot.freshness.isStale).toBe(true);
  });
});
