import { describe, expect, it } from 'vitest';
import {
  buildAgentOfficeSnapshot,
  type AgentOfficeApprovalRow,
  type AgentOfficeIncidentRow,
  type AgentOfficeTaskRow,
  type AgentOfficeTraceRow,
} from './agent-office';

const NOW = '2026-07-28T12:00:00.000Z';

function task(overrides: Partial<AgentOfficeTaskRow> = {}): AgentOfficeTaskRow {
  return {
    id: 'task-1',
    correlation_id: 'run-1',
    source: 'manual',
    agent_type: 'system',
    specialist_id: 'evidence_qa',
    risk_level: 'low',
    status: 'done',
    retry_count: 0,
    max_retries: 2,
    last_error: null,
    assigned_to: null,
    started_at: '2026-07-28T10:00:00.000Z',
    completed_at: '2026-07-28T10:01:00.000Z',
    created_at: '2026-07-28T10:00:00.000Z',
    updated_at: '2026-07-28T10:01:00.000Z',
    task_context: { officeObjective: 'AI 운영 증거 검토' },
    ...overrides,
  };
}

function approval(overrides: Partial<AgentOfficeApprovalRow> = {}): AgentOfficeApprovalRow {
  return {
    id: 'approval-1',
    task_id: 'task-1',
    status: 'pending',
    reason: '외부 발행 전 승인',
    requested_by: 'system',
    reviewed_by: null,
    requested_at: '2026-07-28T10:00:30.000Z',
    reviewed_at: null,
    expires_at: null,
    ...overrides,
  };
}

function incident(overrides: Partial<AgentOfficeIncidentRow> = {}): AgentOfficeIncidentRow {
  return {
    id: 'incident-1',
    correlation_id: 'run-1',
    task_id: 'task-1',
    severity: 'warn',
    category: 'tool_validation',
    message: '입력 검증 필요',
    detected_by: 'system',
    created_at: '2026-07-28T10:00:40.000Z',
    ...overrides,
  };
}

function trace(overrides: Partial<AgentOfficeTraceRow> = {}): AgentOfficeTraceRow {
  return {
    id: 'trace-1',
    trace_id: 'run-1',
    task_id: 'task-1',
    span_name: 'evidence-review',
    agent_type: 'system',
    started_at: '2026-07-28T10:00:00.000Z',
    ended_at: '2026-07-28T10:00:02.000Z',
    duration_ms: 2000,
    ...overrides,
  };
}

describe('buildAgentOfficeSnapshot', () => {
  it('groups related tasks into one workroom and detects real multi-role collaboration', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [
        task(),
        task({
          id: 'task-2',
          specialist_id: 'appsec_privacy',
          status: 'running',
          updated_at: '2026-07-28T10:02:00.000Z',
        }),
      ],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms).toHaveLength(1);
    expect(snapshot.workrooms[0]).toMatchObject({
      correlationId: 'run-1',
      status: 'running',
      isMultiAgent: true,
      progress: { done: 1, total: 2, active: 1 },
    });
    expect(snapshot.workrooms[0]?.roleLabels).toEqual(['evidence qa', 'appsec privacy']);
    expect(snapshot.metrics.multiAgentWorkrooms7d).toBe(1);
  });

  it('uses blocked and highest risk precedence for a workroom', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [
        task({ status: 'done', risk_level: 'low' }),
        task({ id: 'task-2', status: 'frozen', risk_level: 'critical' }),
      ],
      approvals: [approval({ task_id: 'task-2' })],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]).toMatchObject({
      status: 'blocked',
      risk: 'critical',
      pendingApprovals: 1,
    });
    expect(snapshot.metrics.pendingApprovals).toBe(1);
    expect(snapshot.metrics.activeWorkrooms).toBe(1);
  });

  it('computes bounded operational metrics from terminal tasks and traces', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [
        task(),
        task({ id: 'task-2', correlation_id: 'run-2', status: 'done' }),
        task({ id: 'task-3', correlation_id: 'run-3', status: 'failed' }),
        task({
          id: 'task-old',
          correlation_id: 'run-old',
          status: 'failed',
          updated_at: '2026-07-01T00:00:00.000Z',
        }),
      ],
      approvals: [],
      incidents: [],
      traces: [trace({ duration_ms: 100 }), trace({ id: 'trace-2', duration_ms: 1000 })],
      maxWorkrooms: 2,
    });

    expect(snapshot.workrooms).toHaveLength(2);
    expect(snapshot.metrics).toMatchObject({
      completionRate7d: 67,
      terminalTasks7d: 3,
      failedTasks24h: 1,
      p95TraceDurationMs: 1000,
      staleWorkrooms: 0,
    });
  });

  it('does not present abandoned active tasks or old approvals as fresh work', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        status: 'running',
        updated_at: '2026-07-20T10:00:00.000Z',
      })],
      approvals: [approval({
        requested_at: '2026-07-20T10:00:00.000Z',
      })],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.status).toBe('stale');
    expect(snapshot.metrics).toMatchObject({
      activeWorkrooms: 0,
      staleWorkrooms: 1,
      pendingApprovals: 1,
      overdueApprovals: 1,
    });
    expect(snapshot.approvals[0]?.isOverdue).toBe(true);
    expect(snapshot.freshness).toMatchObject({
      latestTaskUpdatedAt: '2026-07-20T10:00:00.000Z',
      isStale: true,
    });
  });

  it('treats an abandoned approval-blocked task as stale instead of active', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        status: 'frozen',
        updated_at: '2026-07-20T10:00:00.000Z',
      })],
      approvals: [approval({
        requested_at: '2026-07-20T10:00:00.000Z',
      })],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.status).toBe('stale');
    expect(snapshot.metrics.activeWorkrooms).toBe(0);
    expect(snapshot.metrics.staleWorkrooms).toBe(1);
  });

  it('uses an explicit approval expiry before the default age policy', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task()],
      approvals: [
        approval({
          requested_at: '2026-07-01T00:00:00.000Z',
          expires_at: '2026-07-29T00:00:00.000Z',
        }),
      ],
      incidents: [],
      traces: [],
    });

    expect(snapshot.approvals[0]?.isOverdue).toBe(false);
    expect(snapshot.metrics.overdueApprovals).toBe(0);
  });

  it('redacts PII from titles, incidents, approvals, and errors', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        task_context: { officeObjective: '김여행 010-1234-5678 example@test.com 확인' },
        last_error: '010-9999-0000에게 연락',
      })],
      approvals: [approval({ reason: 'example@test.com 승인 요청' })],
      incidents: [incident({ message: '연락처 010-1111-2222 노출' })],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.title).not.toContain('010-1234-5678');
    expect(snapshot.workrooms[0]?.title).not.toContain('example@test.com');
    expect(snapshot.workrooms[0]?.tasks[0]?.lastError).toContain('[PHONE]');
    expect(snapshot.approvals[0]?.safeReason).toContain('[EMAIL]');
    expect(snapshot.incidents[0]?.safeMessage).toContain('[PHONE]');
    expect(snapshot.approvals[0]).not.toHaveProperty('reason');
    expect(snapshot.incidents[0]).not.toHaveProperty('message');
  });

  it('never promotes raw userMessage to a workroom title', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        source: 'qa_chat',
        task_context: { userMessage: '여권 M12345678과 계좌 110-123-456789를 확인해줘' },
      })],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.title).toBe('고객 QA 작업');
    expect(snapshot.workrooms[0]?.title).not.toContain('M12345678');
  });

  it('surfaces bounded review-only research evidence without exposing raw task context', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        source: 'research_node',
        agent_type: 'marketing',
        specialist_id: 'research-intake',
        status: 'queued',
        task_context: {
          schema: 'ResearchSignalEnvelopeV1',
          disposition: 'review_required',
          publicationAllowed: false,
          productFactAllowed: false,
          signal: {
            title: '괌 공식 정보 example@test.com',
            excerpt: '공식 사이트에서 새로운 여행 안내 후보가 확인됐습니다.',
            sourceUrl: 'https://www.visitguam.com/articles/',
            sourcePlatform: 'web',
            collectedAt: '2026-07-28T10:00:00.000Z',
            collector: 'crawlee',
            collectorVersion: '3.18.1',
            evidenceClass: 'official_source_candidate',
            confidence: 0.8,
          },
        },
      })],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.title).toContain('[EMAIL]');
    expect(snapshot.workrooms[0]?.tasks[0]?.researchSignal).toMatchObject({
      sourceHostname: 'www.visitguam.com',
      disposition: 'review_required',
      publicationAllowed: false,
      productFactAllowed: false,
    });
    expect(snapshot.workrooms[0]?.tasks[0]?.researchSignal?.sourceUrl)
      .toBe('https://www.visitguam.com/articles/');
  });

  it('does not present malformed research context as reviewed evidence', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        source: 'research_node',
        task_context: {
          schema: 'ResearchSignalEnvelopeV1',
          disposition: 'review_required',
          publicationAllowed: true,
          productFactAllowed: false,
          signal: { title: 'unsafe' },
        },
      })],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.tasks[0]?.researchSignal).toBeNull();
    expect(snapshot.workrooms[0]?.title).toBe('외부 조사 신호');
  });

  it('does not surface research evidence with an invalid collection timestamp', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        source: 'research_node',
        task_context: {
          schema: 'ResearchSignalEnvelopeV1',
          disposition: 'review_required',
          publicationAllowed: false,
          productFactAllowed: false,
          signal: {
            title: '괌 공식 정보',
            excerpt: '공식 사이트에서 새로운 여행 안내 후보가 확인됐습니다.',
            sourceUrl: 'https://www.visitguam.com/articles/',
            sourcePlatform: 'web',
            collectedAt: 'not-a-timestamp',
            collector: 'crawlee',
            collectorVersion: '3.18.1',
            evidenceClass: 'official_source_candidate',
            confidence: 0.8,
          },
        },
      })],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.tasks[0]?.researchSignal).toBeNull();
    expect(snapshot.workrooms[0]?.title).toBe('외부 조사 신호');
  });

  it('turns technical objective identifiers into readable labels', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [task({
        task_context: { officeObjective: 'products.concierge_rag' },
      })],
      approvals: [],
      incidents: [],
      traces: [],
    });

    expect(snapshot.workrooms[0]?.title).toBe('products · concierge rag');
  });

  it('keeps source degradation visible and produces a useful empty snapshot', () => {
    const snapshot = buildAgentOfficeSnapshot({
      generatedAt: NOW,
      tasks: [],
      approvals: [],
      incidents: [],
      traces: [],
      sourceIssues: ['trace source unavailable'],
    });

    expect(snapshot.workrooms).toEqual([]);
    expect(snapshot.metrics.completionRate7d).toBeNull();
    expect(snapshot.sourceIssues).toEqual(['trace source unavailable']);
    expect(snapshot.operatingModel.autonomousLoop).toBe(false);
  });
});
