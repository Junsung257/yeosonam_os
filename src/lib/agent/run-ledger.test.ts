import { describe, expect, it } from 'vitest';

import {
  AgentRunLedgerError,
  AgentRunShadowRowSchema,
  claimAgentRunShadow,
  completeAgentRunShadow,
  createAgentRunShadow,
  hashAgentRunInput,
  reconcileAgentRunShadow,
  transitionAgentRunShadow,
  type AgentRunRpcClient,
  type AgentRunShadowRow,
} from './run-ledger';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-03T03:00:00.000Z';
const LATER = '2026-09-03T03:05:00.000Z';
const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

function runRow(overrides: Partial<AgentRunShadowRow> = {}): AgentRunShadowRow {
  return AgentRunShadowRowSchema.parse({
    id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    tenant_id: null,
    actor_id: 'service.agent-office',
    actor_session_id: 'session.shadow-001',
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
    status: 'created',
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    fencing_token: 0,
    input_schema_hash: SHA_A,
    input_hash: SHA_B,
    output_artifact_ref: null,
    output_hash: null,
    trace_id: null,
    error_code: null,
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
    started_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function rpcClient(handler: (name: string, args: Record<string, unknown>) => unknown): AgentRunRpcClient {
  return {
    rpc: async (name, args) => ({ data: handler(name, args), error: null }),
  };
}

const taskInput = {
  schemaVersion: 'technology-scout-task-input-v1',
  caseId: 'case.paperclip-001',
  observedClaim: 'The project provides an agent company control plane.',
  officialProjectUrl: 'https://github.com/example/project',
  officialDocsUrls: ['https://example.com/docs'],
  evaluationQuestion: 'Does this solve an unmet Yeosonam control-plane need?',
  yeosonamProblemRef: 'problem.agent-office-overlap',
  asOf: NOW,
  objective: {
    schemaVersion: 'task-objective-v1',
    officeObjective: 'Assess one technology without installation.',
    expectedOutcome: 'Produce a review-only evidence packet.',
    stopConditions: ['Stop if official evidence is unavailable.'],
  },
  businessIdempotencyKey: 'technology-scout:paperclip:2026-09-03',
};

describe('agent run shadow writer', () => {
  it('stores only validated contract metadata and a canonical input hash', async () => {
    let observedArgs: Record<string, unknown> = {};
    const client = rpcClient((name, args) => {
      expect(name).toBe('create_agent_run_shadow_v1');
      observedArgs = args;
      return runRow({ input_hash: args.p_input_hash as string });
    });

    const run = await createAgentRunShadow({
      taskId: TASK_ID,
      tenantId: null,
      actorId: 'service.agent-office',
      actorSessionId: 'session.shadow-001',
      roleKey: 'research.technology_scout',
      taskKey: 'research.technology_scout',
      runtimeKey: 'codex_subscription_worker',
      taskInput,
    }, client);

    expect(run.status).toBe('created');
    expect(observedArgs).not.toHaveProperty('p_task_input');
    expect(JSON.stringify(observedArgs)).not.toContain(taskInput.observedClaim);
    expect(observedArgs?.p_input_hash).toBe(hashAgentRunInput(taskInput));
    expect(observedArgs?.p_max_elapsed_ms).toBe(900000);
    expect(observedArgs?.p_tool_profile_key).toBe('research.technology_scout_no_tools');
  });

  it('rejects unregistered roles and invalid task payloads before persistence', async () => {
    let calls = 0;
    const client = rpcClient(() => {
      calls += 1;
      return null;
    });

    await expect(createAgentRunShadow({
      taskId: TASK_ID,
      tenantId: null,
      actorId: 'service.agent-office',
      actorSessionId: 'session.shadow-001',
      roleKey: 'marketing.blog_writer',
      taskKey: 'research.technology_scout',
      runtimeKey: 'codex_subscription_worker',
      taskInput,
    }, client)).rejects.toThrow();

    await expect(createAgentRunShadow({
      taskId: TASK_ID,
      tenantId: null,
      actorId: 'service.agent-office',
      actorSessionId: 'session.shadow-001',
      roleKey: 'research.technology_scout',
      taskKey: 'research.technology_scout',
      runtimeKey: 'codex_subscription_worker',
      taskInput: { ...taskInput, officialProjectUrl: 'http://unsafe.example' },
    }, client)).rejects.toMatchObject({ code: 'AGENT_RUN_TASK_INPUT_INVALID' });
    expect(calls).toBe(0);
  });

  it('keeps the high-entropy lease token out of the database receipt', async () => {
    let sentToken = '';
    const client = rpcClient((name, args) => {
      expect(name).toBe('claim_agent_run_shadow_v1');
      sentToken = args.p_lease_token as string;
      return runRow({
        status: 'leased',
        lease_owner: 'worker.shadow-001',
        lease_expires_at: LATER,
        heartbeat_at: NOW,
        fencing_token: 1,
      });
    });

    const claim = await claimAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseOwner: 'worker.shadow-001',
      leaseSeconds: 300,
    }, client);

    expect(sentToken.length).toBeGreaterThanOrEqual(32);
    expect(claim?.lease.leaseToken).toBe(sentToken);
    expect(claim?.run).not.toHaveProperty('lease_token_hash');
    expect(claim?.lease.fencingToken).toBe(1);
  });

  it('requires an allowed lifecycle edge and passes token plus fence to every mutation', async () => {
    const token = 'x'.repeat(43);
    await expect(transitionAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseToken: token,
      fencingToken: 1,
      expectedStatus: 'leased',
      nextStatus: 'running',
    }, rpcClient(() => null))).rejects.toMatchObject({ code: 'AGENT_RUN_INVALID_TRANSITION' });

    let transitionArgs: Record<string, unknown> | null = null;
    await transitionAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseToken: token,
      fencingToken: 7,
      expectedStatus: 'leased',
      nextStatus: 'starting',
    }, rpcClient((_name, args) => {
      transitionArgs = args;
      return null;
    }));
    expect(transitionArgs).toMatchObject({ p_lease_token: token, p_fencing_token: 7 });
  });

  it('fails closed on malformed or error-bearing database receipts', async () => {
    await expect(claimAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseOwner: 'worker.shadow-001',
      leaseSeconds: 300,
    }, rpcClient(() => ({ ...runRow(), lease_token_hash: 'should-never-leave-db' })))).rejects
      .toMatchObject({ code: 'AGENT_RUN_INVALID_DATABASE_RECEIPT' });

    const failingClient: AgentRunRpcClient = {
      rpc: async () => ({ data: null, error: { code: '42501' } }),
    };
    await expect(claimAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseOwner: 'worker.shadow-001',
      leaseSeconds: 300,
    }, failingClient)).rejects.toEqual(expect.objectContaining<Partial<AgentRunLedgerError>>({
      code: 'AGENT_RUN_CLAIM_FAILED',
      databaseCode: '42501',
    }));
  });

  it('validates terminal success evidence before calling the database', async () => {
    let calls = 0;
    const client = rpcClient(() => {
      calls += 1;
      return null;
    });
    await expect(completeAgentRunShadow({
      runId: RUN_ID,
      tenantId: null,
      leaseToken: 'x'.repeat(43),
      fencingToken: 1,
      outcome: 'succeeded',
      outputArtifactRef: null,
      outputHash: null,
      errorCode: null,
      usage: { inputTokens: 1, outputTokens: 1, toolCalls: 0, elapsedMs: 1, costUsd: null },
    }, client)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});

describe('agent run shadow reconciliation', () => {
  it('reports aligned terminal task and trace evidence as matched', () => {
    const run = runRow({
      status: 'succeeded',
      lease_owner: 'worker.shadow-001',
      heartbeat_at: LATER,
      fencing_token: 1,
      output_artifact_ref: 'artifact.radar-001',
      output_hash: SHA_A,
      started_at: NOW,
      completed_at: LATER,
      updated_at: LATER,
      trace_id: 'trace.shadow-001',
    });
    expect(reconcileAgentRunShadow({
      run,
      task: {
        id: TASK_ID,
        tenantId: null,
        agentType: 'system',
        specialistId: 'research.technology_scout',
        status: 'done',
      },
      traces: [{ taskId: TASK_ID, traceId: 'trace.shadow-001', startedAt: NOW, endedAt: LATER }],
    })).toEqual({ authority: 'agent_tasks', outcome: 'matched', findings: [] });
  });

  it('does not promote run state and exposes task/tenant/trace mismatches', () => {
    const run = runRow({ trace_id: 'trace.shadow-001' });
    const result = reconcileAgentRunShadow({
      run,
      task: {
        id: TASK_ID,
        tenantId: '33333333-3333-4333-8333-333333333333',
        agentType: 'marketing',
        specialistId: 'marketing.blog_writer',
        status: 'done',
      },
      traces: [{
        taskId: '44444444-4444-4444-8444-444444444444',
        traceId: 'trace.shadow-001',
        startedAt: NOW,
        endedAt: null,
      }],
    });
    expect(result.authority).toBe('agent_tasks');
    expect(result.outcome).toBe('mismatch');
    expect(result.findings).toEqual(expect.arrayContaining([
      'tenant_mismatch',
      'legacy_role_binding_mismatch',
      'trace_task_mismatch',
    ]));
  });

  it('keeps nonterminal comparison pending instead of inventing a Run-backed task result', () => {
    const result = reconcileAgentRunShadow({
      run: runRow(),
      task: {
        id: TASK_ID,
        tenantId: null,
        agentType: 'system',
        specialistId: 'research.technology_scout',
        status: 'queued',
      },
      traces: [],
    });
    expect(result).toEqual({
      authority: 'agent_tasks',
      outcome: 'pending',
      findings: ['task_run_both_nonterminal', 'trace_not_bound'],
    });
  });
});
