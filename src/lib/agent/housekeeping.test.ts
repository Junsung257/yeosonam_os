import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { runAgentHousekeeping } from '@/lib/agent/housekeeping';

type Row = Record<string, unknown>;
type Database = Record<string, Row[]>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private updatePatch: Row | null = null;
  private maxRows = Number.POSITIVE_INFINITY;

  constructor(
    private readonly rows: Row[],
  ) {}

  select() {
    return this;
  }

  update(patch: Row) {
    this.updatePatch = patch;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }

  is(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matches = this.rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .slice(0, this.maxRows);
    if (this.updatePatch) {
      for (const row of matches) Object.assign(row, this.updatePatch);
    }
    return Promise.resolve({ data: matches.map((row) => ({ ...row })), error: null })
      .then(onfulfilled ?? ((value) => value as TResult1));
  }
}

function fakeClient(database: Database): SupabaseClient {
  return {
    from(table: string) {
      return new FakeQuery(database[table] ?? []);
    },
  } as unknown as SupabaseClient;
}

describe('runAgentHousekeeping', () => {
  it('updates stale rows once and is idempotent on repeated delivery', async () => {
    const database: Database = {
      agent_approvals: [{
        id: 'approval-1',
        task_id: 'task-1',
        status: 'pending',
        requested_at: '2026-07-20T00:00:00Z',
        created_at: '2026-07-20T00:00:00Z',
        expires_at: null,
      }],
      agent_tasks: [{
        id: 'task-1',
        status: 'frozen',
        source: 'qa_chat',
        updated_at: '2026-07-20T00:00:00Z',
        expires_at: null,
      }, {
        id: 'task-2',
        status: 'running',
        source: 'qa_chat',
        updated_at: '2026-07-20T00:00:00Z',
        expires_at: null,
      }],
      agent_trace_spans: [{
        id: 'trace-1',
        started_at: '2026-07-20T00:00:00Z',
        ended_at: null,
      }],
    };
    const client = fakeClient(database);
    const now = new Date('2026-07-29T00:00:00Z');

    const first = await runAgentHousekeeping({ client, now });
    expect(first.expired).toEqual({ approvals: 1, tasks: 2, traces: 1 });
    expect(database.agent_approvals[0].status).toBe('expired');
    expect(database.agent_tasks.map((row) => row.status)).toEqual(['expired', 'expired']);
    expect(database.agent_trace_spans[0].ended_at).toBe(now.toISOString());

    const second = await runAgentHousekeeping({ client, now });
    expect(second.expired).toEqual({ approvals: 0, tasks: 0, traces: 0 });
  });
});
