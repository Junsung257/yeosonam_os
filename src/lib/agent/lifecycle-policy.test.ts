import { describe, expect, it } from 'vitest';
import {
  buildAgentHousekeepingPlan,
  DEFAULT_AGENT_APPROVAL_TTL_MS,
  resolveAgentApprovalExpiry,
} from '@/lib/agent/lifecycle-policy';

const NOW = new Date('2026-07-29T00:00:00.000Z');

describe('agent lifecycle policy', () => {
  it('gives approvals a seven-day default expiry', () => {
    expect(resolveAgentApprovalExpiry(undefined, NOW)).toBe(
      new Date(NOW.getTime() + DEFAULT_AGENT_APPROVAL_TTL_MS).toISOString(),
    );
  });

  it('preserves a valid explicit expiry and rejects malformed values', () => {
    expect(resolveAgentApprovalExpiry('2026-08-01T00:00:00Z', NOW)).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(() => resolveAgentApprovalExpiry('not-a-date', NOW)).toThrow(
      '유효하지 않은 승인 만료시각입니다.',
    );
  });

  it('expires legacy approvals, attached frozen tasks, stale request tasks, and traces', () => {
    const plan = buildAgentHousekeepingPlan({
      now: NOW,
      approvals: [
        {
          id: 'approval-legacy',
          task_id: 'task-frozen',
          status: 'pending',
          requested_at: '2026-07-20T00:00:00Z',
          expires_at: null,
        },
        {
          id: 'approval-fresh',
          task_id: 'task-fresh-frozen',
          status: 'pending',
          requested_at: '2026-07-28T00:00:00Z',
          expires_at: null,
        },
      ],
      tasks: [
        {
          id: 'task-frozen',
          status: 'frozen',
          source: 'qa_chat',
          updated_at: '2026-07-20T00:00:00Z',
          expires_at: null,
        },
        {
          id: 'task-running',
          status: 'running',
          source: 'qa_chat',
          updated_at: '2026-07-27T00:00:00Z',
          expires_at: null,
        },
        {
          id: 'task-durable',
          status: 'running',
          source: 'cron',
          updated_at: '2026-07-20T00:00:00Z',
          expires_at: null,
        },
        {
          id: 'task-fresh-frozen',
          status: 'frozen',
          source: 'qa_chat',
          updated_at: '2026-07-28T12:00:00Z',
          expires_at: null,
        },
      ],
      traces: [
        { id: 'trace-stale', started_at: '2026-07-27T00:00:00Z', ended_at: null },
        { id: 'trace-fresh', started_at: '2026-07-28T12:00:00Z', ended_at: null },
        {
          id: 'trace-closed',
          started_at: '2026-07-20T00:00:00Z',
          ended_at: '2026-07-20T00:01:00Z',
        },
      ],
    });

    expect(plan).toEqual({
      approvalIds: ['approval-legacy'],
      taskIds: ['task-frozen', 'task-running'],
      traceIds: ['trace-stale'],
    });
  });

  it('honors explicit task and approval expiry for otherwise durable sources', () => {
    const plan = buildAgentHousekeepingPlan({
      now: NOW,
      approvals: [{
        id: 'approval-explicit',
        task_id: 'task-explicit',
        status: 'pending',
        requested_at: '2026-07-28T23:00:00Z',
        expires_at: '2026-07-28T23:30:00Z',
      }],
      tasks: [{
        id: 'task-explicit',
        status: 'running',
        source: 'cron',
        updated_at: '2026-07-28T23:00:00Z',
        expires_at: '2026-07-28T23:30:00Z',
      }],
      traces: [],
    });

    expect(plan.approvalIds).toEqual(['approval-explicit']);
    expect(plan.taskIds).toEqual(['task-explicit']);
  });
});
