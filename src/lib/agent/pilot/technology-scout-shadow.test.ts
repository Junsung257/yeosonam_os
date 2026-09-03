import { describe, expect, it } from 'vitest';

import { AgentRunShadowRowSchema, type AgentRunShadowRow } from '@/lib/agent/run-ledger';
import { RuntimeResultV1Schema } from '@/lib/agent/contracts';
import { TECHNOLOGY_SCOUT_SOURCE_FIXTURES } from '@/lib/agent/pilot';
import type { AgentRuntimeAdapter } from '@/lib/agent/runtime';

import {
  resolveTechnologyScoutShadowPilotEnvironment,
  runTechnologyScoutShadowPilot,
  type ShadowPilotDependencies,
} from './technology-scout-shadow';

const FIXTURE = TECHNOLOGY_SCOUT_SOURCE_FIXTURES[0];
const TASK_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-09-04T00:00:00.000Z';

function fakeRun(status: AgentRunShadowRow['status'] = 'created'): AgentRunShadowRow {
  const active = ['leased', 'starting', 'running', 'waiting_approval'].includes(status);
  const terminal = ['succeeded', 'failed', 'timed_out', 'cancelled', 'orphaned'].includes(status);
  return AgentRunShadowRowSchema.parse({
    id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    tenant_id: null,
    actor_id: 'admin@example.com',
    actor_session_id: 'office-shadow-session:test',
    role_key: 'research.technology_scout',
    role_version: '1.0.0',
    task_key: 'research.technology_scout',
    task_contract_version: '1.0.0',
    runtime_key: 'codex_subscription_worker',
    runtime_version: '1.0.0',
    tool_profile_key: 'research.technology_scout_no_tools',
    tool_profile_version: '1.0.0',
    provider_key: null,
    model_key: null,
    execution_mode: 'shadow',
    authoritative: false,
    command_access_allowed: false,
    production_access: false,
    data_classification: 'public',
    status,
    lease_owner: status === 'created' ? null : 'technology-scout-worker:test',
    lease_expires_at: active ? '2026-09-04T00:15:00.000Z' : null,
    heartbeat_at: status === 'created' ? null : NOW,
    fencing_token: status === 'created' ? 0 : 1,
    input_schema_hash: 'sha256:eaa48f597e687e7cbd3f10cb93b6440d11828bfc49c43dd75716b7e0453a37dc',
    input_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    output_artifact_ref: status === 'succeeded' ? `shadow-output:${TASK_ID}:${RUN_ID}` : null,
    output_hash: status === 'succeeded' ? 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : null,
    trace_id: 'trace:technology-scout:test',
    error_code: terminal && status !== 'succeeded' ? 'TEST_FAILURE' : null,
    policy_snapshot: { authoritative: false },
    budget_snapshot: { maxElapsedMs: 900000 },
    max_elapsed_ms: 900000,
    max_turns: 8,
    max_tool_calls: 12,
    max_input_tokens: 80000,
    max_output_tokens: 12000,
    max_cost_usd: null,
    input_tokens: 0,
    output_tokens: 0,
    tool_calls: 0,
    elapsed_ms: 0,
    cost_usd: null,
    started_at: active || terminal ? NOW : null,
    completed_at: terminal ? NOW : null,
    created_at: NOW,
    updated_at: NOW,
  });
}

function dependencies(overrides?: Partial<ShadowPilotDependencies>): ShadowPilotDependencies {
  const row = fakeRun();
  const calls: string[] = [];
  const runtime: AgentRuntimeAdapter = {
    health: async () => ({ runtimeKey: 'codex_subscription_worker', runtimeVersion: '1.0.0', status: 'healthy', checkedAt: NOW, detailCode: 'CHATGPT_SUBSCRIPTION_READY' }),
    start: async () => RuntimeResultV1Schema.parse({
      schemaVersion: 'runtime-result-v1',
      runId: RUN_ID,
      runtimeKey: 'codex_subscription_worker',
      runtimeVersion: '1.0.0',
      providerKey: null,
      modelKey: 'gpt-5.4-mini',
      outputArtifactRef: `shadow-output:${TASK_ID}:${RUN_ID}`,
      outputHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      usage: { inputTokens: 10, outputTokens: 20, toolCalls: 0, elapsedMs: 30, costUsd: null },
      outcome: 'succeeded',
      errorCode: null,
    }),
  };
  return {
    environment: { mode: 'local', enabled: true, code: 'SHADOW_PILOT_ENABLED' },
    rpcClient: { rpc: async () => ({ data: null, error: null }) },
    taskStore: {
      createTask: async () => ({ id: TASK_ID, status: 'queued', duplicate: false }),
      transitionTask: async (_taskId, _from, to) => { calls.push(`task:${to}`); return { id: TASK_ID, status: to }; },
      persistResult: async () => { calls.push('result'); },
    },
    runLedger: {
      create: async () => { calls.push('run:create'); return row; },
      claim: async () => { calls.push('run:claim'); return { run: fakeRun('leased'), lease: { leaseToken: 'x'.repeat(32), fencingToken: 1, expiresAt: NOW } }; },
      transition: async (input) => { calls.push(`run:${input.nextStatus}`); return fakeRun(input.nextStatus); },
      complete: async () => { calls.push('run:complete'); return row; },
    },
    runtime,
    registerCapability: () => { calls.push('capability'); },
    getOutputPayload: () => ({ schemaVersion: 'technology-radar-entry-v1', project: { name: 'Paperclip' } }),
    ...overrides,
  };
}

describe('technology scout shadow pilot', () => {
  it('blocks production and disabled environments before task creation', async () => {
    expect(resolveTechnologyScoutShadowPilotEnvironment({ nodeEnv: 'production', enabledFlag: '1' })).toMatchObject({ enabled: false, code: 'SHADOW_PILOT_PRODUCTION_BLOCKED' });
    expect(resolveTechnologyScoutShadowPilotEnvironment({ nodeEnv: 'production', vercelEnv: 'preview', enabledFlag: '1' })).toMatchObject({ enabled: true, mode: 'preview' });
    expect(resolveTechnologyScoutShadowPilotEnvironment({ nodeEnv: 'development', enabledFlag: '0' })).toMatchObject({ enabled: false, code: 'SHADOW_PILOT_DISABLED' });
    const createTask = async () => ({ id: TASK_ID, status: 'queued' as const, duplicate: false });
    const result = await runTechnologyScoutShadowPilot({ caseId: FIXTURE.caseId, actorId: 'admin@example.com', workspaceRoot: 'C:\\work\\preview', model: 'gpt-5.4-mini' }, dependencies({
      environment: { mode: 'production', enabled: false, code: 'SHADOW_PILOT_PRODUCTION_BLOCKED' },
      taskStore: { ...dependencies().taskStore, createTask },
    }));
    expect(result).toMatchObject({ status: 'blocked', errorCode: 'SHADOW_PILOT_PRODUCTION_BLOCKED' });
  });

  it('runs one bounded task through the shadow ledger and closes the task', async () => {
    const calls: string[] = [];
    const deps = dependencies();
    deps.taskStore.transitionTask = async (_taskId, _from, to) => { calls.push(`task:${to}`); return { id: TASK_ID, status: to }; };
    deps.taskStore.persistResult = async () => { calls.push('result'); };
    deps.runLedger.create = async () => { calls.push('run:create'); return fakeRun(); };
    deps.runLedger.claim = async () => { calls.push('run:claim'); return { run: fakeRun('leased'), lease: { leaseToken: 'x'.repeat(32), fencingToken: 1, expiresAt: NOW } }; };
    deps.runLedger.transition = async (input) => { calls.push(`run:${input.nextStatus}`); return fakeRun(input.nextStatus); };
    deps.runLedger.complete = async () => { calls.push('run:complete'); return fakeRun(); };
    const result = await runTechnologyScoutShadowPilot({ caseId: FIXTURE.caseId, actorId: 'admin@example.com', workspaceRoot: 'C:\\work\\preview', model: 'gpt-5.4-mini' }, deps);
    expect(result.status).toBe('succeeded');
    expect(calls).toEqual(['task:running', 'run:create', 'run:claim', 'run:starting', 'run:running', 'run:complete', 'result', 'task:done']);
    expect(result.payload).toMatchObject({ schemaVersion: 'technology-radar-entry-v1' });
  });
});
