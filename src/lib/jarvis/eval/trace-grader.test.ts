import { describe, expect, it } from 'vitest';
import { mergeTraceMetadata } from '@/lib/telemetry/agent-tracing';
import { gradeJarvisTrace } from './trace-grader';

describe('Jarvis trace grader', () => {
  it('passes a complete low-risk streaming trace', () => {
    const result = gradeJarvisTrace({
      traceId: 'trace-1',
      task: {
        id: 'task-1',
        status: 'done',
        riskLevel: 'low',
        agentType: 'products',
        specialistId: 'products.concierge_rag',
      },
      spans: [
        {
          id: 'span-1',
          traceId: 'trace-1',
          spanName: 'jarvis_stream_total',
          sessionId: 'session-1',
          taskId: 'task-1',
          agentType: 'products',
          endedAt: '2026-06-05T00:00:02.000Z',
          durationMs: 2000,
          metadata: {
            specialistId: 'products.concierge_rag',
            ttftMs: 300,
            totalLatencyMs: 2000,
          },
        },
      ],
      incidents: [],
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('fails high-risk traces that finish without human approval', () => {
    const result = gradeJarvisTrace({
      traceId: 'trace-2',
      task: {
        id: 'task-2',
        status: 'done',
        riskLevel: 'critical',
        agentType: 'finance',
        specialistId: 'finance.settlement_tax',
      },
      spans: [
        {
          id: 'span-2',
          traceId: 'trace-2',
          spanName: 'jarvis_stream_total',
          sessionId: 'session-2',
          taskId: 'task-2',
          agentType: 'finance',
          endedAt: '2026-06-05T00:00:03.000Z',
          durationMs: 3000,
          metadata: { specialistId: 'finance.settlement_tax', ttftMs: 500, totalLatencyMs: 3000 },
        },
      ],
      incidents: [],
    });

    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.name === 'high_risk_human_review')?.passed).toBe(false);
  });

  it('keeps start metadata when ending a span', () => {
    expect(mergeTraceMetadata(
      { specialistId: 'operations.payment_match', method: 'keyword' },
      { totalLatencyMs: 1200, ttftMs: 100 },
    )).toEqual({
      specialistId: 'operations.payment_match',
      method: 'keyword',
      totalLatencyMs: 1200,
      ttftMs: 100,
    });
  });
});
