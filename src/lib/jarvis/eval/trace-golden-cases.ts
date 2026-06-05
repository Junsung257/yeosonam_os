import type { TraceGradeInput } from './trace-grader';

export const TRACE_GOLDEN_CASES: TraceGradeInput[] = [
  {
    traceId: 'trace-low-risk-complete',
    task: {
      id: 'task-low-risk-complete',
      status: 'done',
      riskLevel: 'low',
      agentType: 'products',
      specialistId: 'products.concierge_rag',
    },
    spans: [
      {
        id: 'span-low-risk-complete',
        traceId: 'trace-low-risk-complete',
        spanName: 'jarvis_stream_total',
        sessionId: 'session-low-risk-complete',
        taskId: 'task-low-risk-complete',
        agentType: 'products',
        endedAt: '2026-06-05T00:00:02.000Z',
        durationMs: 2000,
        metadata: {
          specialistId: 'products.concierge_rag',
          ttftMs: 280,
          totalLatencyMs: 2000,
        },
      },
    ],
    incidents: [],
  },
  {
    traceId: 'trace-high-risk-approved',
    task: {
      id: 'task-high-risk-approved',
      status: 'done',
      riskLevel: 'critical',
      agentType: 'finance',
      specialistId: 'finance.settlement_tax',
      approvedBy: 'admin:test',
    },
    spans: [
      {
        id: 'span-high-risk-approved',
        traceId: 'trace-high-risk-approved',
        spanName: 'jarvis_stream_total',
        sessionId: 'session-high-risk-approved',
        taskId: 'task-high-risk-approved',
        agentType: 'finance',
        endedAt: '2026-06-05T00:00:04.000Z',
        durationMs: 4000,
        metadata: {
          specialistId: 'finance.settlement_tax',
          ttftMs: 700,
          totalLatencyMs: 4000,
        },
      },
    ],
    incidents: [],
  },
  {
    traceId: 'trace-guardrail-cancelled',
    task: {
      id: 'task-guardrail-cancelled',
      status: 'cancelled',
      riskLevel: 'high',
      agentType: 'system',
      specialistId: 'system.policy_audit',
      lastError: 'approval rejected',
    },
    spans: [
      {
        id: 'span-guardrail-cancelled',
        traceId: 'trace-guardrail-cancelled',
        spanName: 'jarvis_stream_total',
        sessionId: 'session-guardrail-cancelled',
        taskId: 'task-guardrail-cancelled',
        agentType: 'system',
        endedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        metadata: {
          specialistId: 'system.policy_audit',
          totalLatencyMs: 1000,
        },
      },
    ],
    incidents: [],
  },
];
