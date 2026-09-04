import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  buildTechnologyScoutPublicArtifacts,
  buildTechnologyScoutTaskInput,
  sha256,
  stableJson,
  TECHNOLOGY_SCOUT_SOURCE_FIXTURES,
  type TechnologyScoutSourceFixture,
} from './technology-scout-fixtures';
import {
  claimAgentRunShadow,
  completeAgentRunShadow,
  createAgentRunShadow,
  transitionAgentRunShadow,
  type AgentRunRpcClient,
  type AgentRunShadowRow,
} from '@/lib/agent/run-ledger';
import {
  createAgentTaskIdempotently,
  transitionAgentTask,
} from '@/lib/agent/tasking';
import { getSupabaseAdmin, isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { getTaskDefinition } from '@/lib/agent/contracts';
import type { AgentRuntimeAdapter, RuntimeCapabilityClaims } from '@/lib/agent/runtime';
import type { AgentTaskEnvelope, AgentTaskStatus } from '@/lib/agent/envelope';
import {
  resolveTechnologyScoutShadowPilotEnvironment,
  type ShadowPilotEnvironment,
} from './environment';

export { resolveTechnologyScoutShadowPilotEnvironment } from './environment';
export type { ShadowPilotEnvironment } from './environment';

export type TechnologyScoutShadowPilotInput = {
  caseId: string;
  actorId: string;
  actorSessionId?: string;
  workspaceRoot: string;
  model: string;
};

export type TechnologyScoutShadowPilotResult = {
  status: 'succeeded' | 'failed' | 'blocked' | 'duplicate';
  caseId: string;
  taskId: string | null;
  runId: string | null;
  attemptNumber: number | null;
  errorCode: string | null;
  outputArtifactRef: string | null;
  outputHash: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    elapsedMs: number;
    costUsd: number | null;
  } | null;
  payload: unknown | null;
};

type TaskRow = { id: string; status: AgentTaskStatus; duplicate: boolean };

type ShadowPilotTaskStore = {
  createTask(envelope: AgentTaskEnvelope): Promise<TaskRow>;
  transitionTask(taskId: string, from: AgentTaskStatus, to: AgentTaskStatus, patch?: Record<string, unknown>): Promise<unknown>;
  persistResult(taskId: string, result: {
    caseId: string;
    runId: string;
    outputArtifactRef: string;
    outputHash: string;
    payload: unknown;
  }): Promise<void>;
};

type ShadowPilotRunLedger = {
  create(input: Parameters<typeof createAgentRunShadow>[0]): Promise<AgentRunShadowRow>;
  claim(input: Parameters<typeof claimAgentRunShadow>[0]): Promise<Awaited<ReturnType<typeof claimAgentRunShadow>>>;
  transition(input: Parameters<typeof transitionAgentRunShadow>[0]): Promise<AgentRunShadowRow | null>;
  complete(input: Parameters<typeof completeAgentRunShadow>[0]): Promise<AgentRunShadowRow | null>;
};

export type ShadowPilotDependencies = {
  taskStore: ShadowPilotTaskStore;
  runLedger: ShadowPilotRunLedger;
  runtime: AgentRuntimeAdapter;
  rpcClient: AgentRunRpcClient;
  registerCapability?: (input: { token: string; claims: RuntimeCapabilityClaims }) => void;
  getOutputPayload?: (runId: string) => unknown | null;
  now?: () => Date;
  environment?: ShadowPilotEnvironment;
};

function findFixture(caseId: string): TechnologyScoutSourceFixture | null {
  return TECHNOLOGY_SCOUT_SOURCE_FIXTURES.find((fixture) => fixture.caseId === caseId) ?? null;
}

function errorCodeFrom(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{1,119}$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.:-]{1,119}$/u.test(error.message)) {
    return error.message;
  }
  return 'TECHNOLOGY_SCOUT_SHADOW_FAILED';
}

function createCapabilityClaims(input: {
  runId: string;
  taskId: string;
  workspaceRoot: string;
  now: Date;
}): { token: string; claims: RuntimeCapabilityClaims } {
  const token = randomBytes(32).toString('base64url');
  const issuedAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + 15 * 60_000).toISOString();
  return {
    token,
    claims: {
      mode: 'shadow_read_only',
      runId: input.runId,
      taskId: input.taskId,
      tenantId: null,
      roleKey: 'research.technology_scout',
      taskKey: 'research.technology_scout',
      dataClassification: 'public',
      issuedAt,
      expiresAt,
      readableRoots: [input.workspaceRoot],
    },
  };
}

function buildFailure(input: Pick<TechnologyScoutShadowPilotResult, 'caseId' | 'taskId' | 'runId'>, errorCode: string): TechnologyScoutShadowPilotResult {
  return {
    status: 'failed',
    caseId: input.caseId,
    taskId: input.taskId,
    runId: input.runId,
    attemptNumber: null,
    errorCode,
    outputArtifactRef: null,
    outputHash: null,
    usage: null,
    payload: null,
  };
}

export async function runTechnologyScoutShadowPilot(
  input: TechnologyScoutShadowPilotInput,
  dependencies: ShadowPilotDependencies,
): Promise<TechnologyScoutShadowPilotResult> {
  const now = dependencies.now ?? (() => new Date());
  const environment = dependencies.environment ?? resolveTechnologyScoutShadowPilotEnvironment();
  const fixture = findFixture(input.caseId);
  if (!fixture) {
    return { ...buildFailure({ caseId: input.caseId, taskId: null, runId: null }, 'TECHNOLOGY_SCOUT_CASE_NOT_FOUND'), status: 'blocked' };
  }
  if (!environment.enabled) {
    return { ...buildFailure({ caseId: fixture.caseId, taskId: null, runId: null }, environment.code), status: 'blocked' };
  }

  const taskDefinition = getTaskDefinition('research.technology_scout');
  if (!taskDefinition) {
    return { ...buildFailure({ caseId: fixture.caseId, taskId: null, runId: null }, 'TECHNOLOGY_SCOUT_CONTRACT_MISSING'), status: 'blocked' };
  }

  const taskInput = buildTechnologyScoutTaskInput(fixture);
  // The existing agent_tasks ledger uses a UUID correlation id in production;
  // keep the human-readable case in task_context instead of changing that SSOT.
  const correlationId = randomUUID();
  const envelope: AgentTaskEnvelope = {
    correlationId,
    source: 'manual',
    agentType: 'system',
    specialistId: 'research.technology_scout',
    performative: 'request',
    riskLevel: 'medium',
    status: 'queued',
    idempotencyKey: taskInput.businessIdempotencyKey,
    taskContext: {
      contract: 'research.technology_scout@1.0.0',
      shadowOnly: true,
      taskInput,
      inputArtifactRefs: buildTechnologyScoutPublicArtifacts(fixture).map((artifact) => artifact.artifactRef),
    },
    createdBy: input.actorId,
    assignedTo: input.actorId,
  };

  let task: TaskRow;
  try {
    task = await dependencies.taskStore.createTask(envelope);
  } catch (error) {
    return buildFailure({ caseId: fixture.caseId, taskId: null, runId: null }, errorCodeFrom(error));
  }
  if (task.duplicate) {
    return {
      status: 'duplicate',
      caseId: fixture.caseId,
      taskId: task.id,
      runId: null,
      attemptNumber: null,
      errorCode: 'BUSINESS_TASK_ALREADY_EXISTS',
      outputArtifactRef: null,
      outputHash: null,
      usage: null,
      payload: null,
    };
  }

  let run: AgentRunShadowRow | null = null;
  let leased: Awaited<ReturnType<typeof claimAgentRunShadow>> = null;
  try {
    await dependencies.taskStore.transitionTask(task.id, 'queued', 'running', {
      started_at: now().toISOString(),
    });
    run = await dependencies.runLedger.create({
      taskId: task.id,
      tenantId: null,
      actorId: input.actorId,
      actorSessionId: input.actorSessionId ?? `office-shadow-session:${randomUUID()}`,
      roleKey: 'research.technology_scout',
      taskKey: 'research.technology_scout',
      runtimeKey: 'codex_subscription_worker',
      traceId: `trace:technology-scout:${randomUUID()}`,
      taskInput,
    });
    leased = await dependencies.runLedger.claim({
      runId: run.id,
      tenantId: null,
      leaseOwner: `technology-scout-worker:${randomUUID()}`,
      leaseSeconds: 900,
    });
    if (!leased) throw new Error('AGENT_RUN_CLAIM_NOT_CONFIRMED');
    await dependencies.runLedger.transition({
      runId: run.id,
      tenantId: null,
      leaseToken: leased.lease.leaseToken,
      fencingToken: leased.lease.fencingToken,
      expectedStatus: 'leased',
      nextStatus: 'starting',
    });
    await dependencies.runLedger.transition({
      runId: run.id,
      tenantId: null,
      leaseToken: leased.lease.leaseToken,
      fencingToken: leased.lease.fencingToken,
      expectedStatus: 'starting',
      nextStatus: 'running',
    });

    const capability = createCapabilityClaims({
      runId: run.id,
      taskId: task.id,
      workspaceRoot: input.workspaceRoot,
      now: now(),
    });
    dependencies.registerCapability?.(capability);
    const runtime = dependencies.runtime;
    const runtimeResult = await runtime.start({
      runId: run.id,
      taskId: task.id,
      tenantId: null,
      roleKey: 'research.technology_scout',
      roleVersion: '1.0.0',
      taskKey: 'research.technology_scout',
      taskContractVersion: '1.0.0',
      runtimeKey: 'codex_subscription_worker',
      runtimeVersion: '1.0.0',
      toolProfileKey: 'research.technology_scout_no_tools',
      toolProfileVersion: '1.0.0',
      inputArtifactRefs: buildTechnologyScoutPublicArtifacts(fixture).map((artifact) => artifact.artifactRef),
      taskInput,
      workspaceRoot: input.workspaceRoot,
      capabilityToken: capability.token,
      budgets: taskDefinition.budgets,
    });
    const completionOutcome = runtimeResult.outcome === 'orphaned' ? 'failed' : runtimeResult.outcome;
    const completionErrorCode = runtimeResult.outcome === 'orphaned'
      ? (runtimeResult.errorCode ?? 'RUNTIME_ORPHANED')
      : runtimeResult.errorCode;
    const completed = await dependencies.runLedger.complete({
      runId: run.id,
      tenantId: null,
      leaseToken: leased.lease.leaseToken,
      fencingToken: leased.lease.fencingToken,
      outcome: completionOutcome,
      outputArtifactRef: runtimeResult.outputArtifactRef,
      outputHash: runtimeResult.outputHash,
      errorCode: completionErrorCode,
      usage: runtimeResult.usage,
    });
    if (!completed) throw new Error('AGENT_RUN_COMPLETION_NOT_CONFIRMED');

    if (runtimeResult.outcome !== 'succeeded' || !runtimeResult.outputArtifactRef || !runtimeResult.outputHash) {
      await dependencies.taskStore.transitionTask(task.id, 'running', 'failed', {
        last_error: runtimeResult.errorCode ?? 'TECHNOLOGY_SCOUT_RUNTIME_FAILED',
      });
      return {
        status: 'failed', caseId: fixture.caseId, taskId: task.id, runId: run.id,
        attemptNumber: run.attempt_number, errorCode: runtimeResult.errorCode ?? 'TECHNOLOGY_SCOUT_RUNTIME_FAILED',
        outputArtifactRef: null, outputHash: null, usage: runtimeResult.usage, payload: null,
      };
    }

    const outputPayload = dependencies.getOutputPayload?.(run.id) ?? null;
    if (outputPayload === null) {
      throw new Error('SHADOW_OUTPUT_NOT_CAPTURED');
    }
    await dependencies.taskStore.persistResult(task.id, {
      caseId: fixture.caseId,
      runId: run.id,
      outputArtifactRef: runtimeResult.outputArtifactRef,
      outputHash: runtimeResult.outputHash,
      payload: outputPayload,
    });
    await dependencies.taskStore.transitionTask(task.id, 'running', 'done', {
      completed_at: now().toISOString(),
    });
    return {
      status: 'succeeded', caseId: fixture.caseId, taskId: task.id, runId: run.id,
      attemptNumber: run.attempt_number, errorCode: null,
      outputArtifactRef: runtimeResult.outputArtifactRef, outputHash: runtimeResult.outputHash,
      usage: runtimeResult.usage, payload: outputPayload,
    };
  } catch (error) {
    const code = errorCodeFrom(error);
    if (run && leased) {
      await dependencies.runLedger.complete({
        runId: run.id,
        tenantId: null,
        leaseToken: leased.lease.leaseToken,
        fencingToken: leased.lease.fencingToken,
        outcome: 'failed',
        outputArtifactRef: null,
        outputHash: null,
        errorCode: code,
        usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, elapsedMs: 0, costUsd: null },
      }).catch(() => null);
    }
    await dependencies.taskStore.transitionTask(task.id, 'running', 'failed', { last_error: code }).catch(() => undefined);
    return buildFailure({ caseId: fixture.caseId, taskId: task.id, runId: run?.id ?? null }, code);
  }
}

export function createTechnologyScoutShadowPilotDependencies(options: {
  runtime: AgentRuntimeAdapter;
  registerCapability?: (input: { token: string; claims: RuntimeCapabilityClaims }) => void;
  getOutputPayload?: (runId: string) => unknown | null;
}): ShadowPilotDependencies | null {
  const admin = getSupabaseAdmin();
  if (!admin || !isSupabaseAdminConfigured) return null;
  const rpcClient = admin as unknown as AgentRunRpcClient;
  const taskStore: ShadowPilotTaskStore = {
    createTask: createAgentTaskIdempotently,
    transitionTask: transitionAgentTask,
    persistResult: async (taskId, result) => {
      const payload = {
        shadowOnly: true,
        schemaVersion: 'technology-scout-shadow-result-v1',
        caseId: result.caseId,
        runId: result.runId,
        outputArtifactRef: result.outputArtifactRef,
        outputHash: result.outputHash,
        payload: result.payload,
      };
      const { error } = await supabaseAdmin.from('agent_tasks').update({ result_payload: payload }).eq('id', taskId);
      if (error) throw error;
    },
  };
  const runLedger: ShadowPilotRunLedger = {
    create: (input) => createAgentRunShadow(input, rpcClient),
    claim: (input) => claimAgentRunShadow(input, rpcClient),
    transition: (input) => transitionAgentRunShadow(input, rpcClient),
    complete: (input) => completeAgentRunShadow(input, rpcClient),
  };
  return {
    taskStore,
    runLedger,
    rpcClient,
    runtime: options.runtime,
    registerCapability: options.registerCapability,
    getOutputPayload: options.getOutputPayload,
  };
}

export function hashShadowPayload(payload: unknown): `sha256:${string}` {
  return sha256(stableJson(payload));
}

export function createShadowOutputRef(taskId: string, runId: string): string {
  return `shadow-output:${taskId}:${runId}`;
}

export function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
