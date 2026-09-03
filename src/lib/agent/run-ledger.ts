import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { getSupabaseAdmin } from '@/lib/supabase';

import {
  AgentContractKeySchema,
  AgentContractVersionSchema,
  AgentSha256Schema,
  OpaqueAgentReferenceSchema,
  ROLE_OPERATIONAL_BINDINGS,
  getRoleDefinition,
  getRuntimeProfile,
  getTaskDefinition,
  getToolProfile,
  parseAgentContractSchema,
} from './contracts';

const UUID = z.string().uuid();
const ISO_TIMESTAMP = z.string().datetime({ offset: true });

export const AGENT_RUN_SHADOW_STATUSES = [
  'created',
  'leased',
  'starting',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'orphaned',
] as const;

const AgentRunShadowStatusSchema = z.enum(AGENT_RUN_SHADOW_STATUSES);

const NullableDatabaseNumericSchema = z.union([z.number(), z.string()]).nullable().transform((value, context) => {
  if (value === null) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'database numeric must be finite' });
    return z.NEVER;
  }
  return numeric;
});

export const AgentRunShadowRowSchema = z.object({
  id: UUID,
  task_id: UUID,
  attempt_number: z.number().int().positive(),
  tenant_id: UUID.nullable(),
  actor_id: OpaqueAgentReferenceSchema,
  actor_session_id: OpaqueAgentReferenceSchema,
  role_key: AgentContractKeySchema,
  role_version: AgentContractVersionSchema,
  task_key: AgentContractKeySchema,
  task_contract_version: AgentContractVersionSchema,
  runtime_key: AgentContractKeySchema,
  runtime_version: AgentContractVersionSchema,
  tool_profile_key: AgentContractKeySchema,
  tool_profile_version: AgentContractVersionSchema,
  provider_key: AgentContractKeySchema.nullable(),
  model_key: z.string().trim().min(1).max(160).nullable(),
  execution_mode: z.literal('shadow'),
  authoritative: z.literal(false),
  command_access_allowed: z.literal(false),
  production_access: z.literal(false),
  data_classification: z.literal('public'),
  status: AgentRunShadowStatusSchema,
  lease_owner: OpaqueAgentReferenceSchema.nullable(),
  lease_expires_at: ISO_TIMESTAMP.nullable(),
  heartbeat_at: ISO_TIMESTAMP.nullable(),
  fencing_token: z.number().int().nonnegative(),
  input_schema_hash: AgentSha256Schema,
  input_hash: AgentSha256Schema,
  output_artifact_ref: OpaqueAgentReferenceSchema.nullable(),
  output_hash: AgentSha256Schema.nullable(),
  trace_id: OpaqueAgentReferenceSchema.nullable(),
  error_code: z.string().trim().min(2).max(120).nullable(),
  policy_snapshot: z.record(z.unknown()),
  budget_snapshot: z.record(z.unknown()),
  max_elapsed_ms: z.number().int().positive(),
  max_turns: z.number().int().positive(),
  max_tool_calls: z.number().int().nonnegative(),
  max_input_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  max_cost_usd: NullableDatabaseNumericSchema,
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  tool_calls: z.number().int().nonnegative(),
  elapsed_ms: z.number().int().nonnegative(),
  cost_usd: NullableDatabaseNumericSchema,
  started_at: ISO_TIMESTAMP.nullable(),
  completed_at: ISO_TIMESTAMP.nullable(),
  created_at: ISO_TIMESTAMP,
  updated_at: ISO_TIMESTAMP,
}).strict();

export type AgentRunShadowStatus = z.infer<typeof AgentRunShadowStatusSchema>;
export type AgentRunShadowRow = z.infer<typeof AgentRunShadowRowSchema>;

type AgentRunRpcError = {
  code?: string;
};

export type AgentRunRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: AgentRunRpcError | null }>;
};

export class AgentRunLedgerError extends Error {
  readonly code: string;
  readonly databaseCode: string | null;

  constructor(code: string, databaseCode: string | null = null) {
    super(code);
    this.name = 'AgentRunLedgerError';
    this.code = code;
    this.databaseCode = databaseCode;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function hashAgentRunInput(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`;
}

function resolveClient(client?: AgentRunRpcClient): AgentRunRpcClient {
  if (client) return client;
  const admin = getSupabaseAdmin();
  if (!admin) throw new AgentRunLedgerError('AGENT_RUN_SERVICE_CREDENTIAL_REQUIRED');
  return admin as unknown as AgentRunRpcClient;
}

async function callRunRpc(
  client: AgentRunRpcClient,
  functionName: string,
  args: Record<string, unknown>,
  errorCode: string,
): Promise<AgentRunShadowRow | null> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw new AgentRunLedgerError(errorCode, error.code ?? null);
  if (data === null) return null;
  const parsed = AgentRunShadowRowSchema.safeParse(data);
  if (!parsed.success) throw new AgentRunLedgerError('AGENT_RUN_INVALID_DATABASE_RECEIPT');
  return parsed.data;
}

const CreateAgentRunShadowInputSchema = z.object({
  taskId: UUID,
  tenantId: UUID.nullable(),
  actorId: OpaqueAgentReferenceSchema,
  actorSessionId: OpaqueAgentReferenceSchema,
  roleKey: AgentContractKeySchema,
  taskKey: AgentContractKeySchema,
  runtimeKey: AgentContractKeySchema,
  traceId: OpaqueAgentReferenceSchema.nullable().default(null),
  taskInput: z.unknown(),
}).strict();

export type CreateAgentRunShadowInput = z.input<typeof CreateAgentRunShadowInputSchema>;

export async function createAgentRunShadow(
  input: CreateAgentRunShadowInput,
  rpcClient?: AgentRunRpcClient,
): Promise<AgentRunShadowRow> {
  const parsedInput = CreateAgentRunShadowInputSchema.parse(input);
  const role = getRoleDefinition(parsedInput.roleKey);
  const task = getTaskDefinition(parsedInput.taskKey);
  const runtime = getRuntimeProfile(parsedInput.runtimeKey);
  const binding = ROLE_OPERATIONAL_BINDINGS[
    parsedInput.roleKey as keyof typeof ROLE_OPERATIONAL_BINDINGS
  ];

  if (!role || !task || !runtime || !binding) {
    throw new AgentRunLedgerError('AGENT_RUN_CONTRACT_NOT_REGISTERED');
  }
  if (!task.allowedRoleRefs.some((ref) => ref.key === role.roleKey && ref.version === role.version)
    || !task.allowedRuntimeRefs.some((ref) => (
      ref.key === runtime.runtimeKey && ref.version === runtime.version
    ))) {
    throw new AgentRunLedgerError('AGENT_RUN_CONTRACT_REFERENCE_MISMATCH');
  }

  const toolProfile = getToolProfile(task.toolProfileRef.key);
  if (!toolProfile
    || toolProfile.version !== task.toolProfileRef.version
    || binding.roleRef.key !== role.roleKey
    || binding.roleRef.version !== role.version
    || binding.runtimeRef.key !== runtime.runtimeKey
    || binding.runtimeRef.version !== runtime.version
    || binding.toolProfileRef.key !== toolProfile.toolProfileKey
    || binding.toolProfileRef.version !== toolProfile.version) {
    throw new AgentRunLedgerError('AGENT_RUN_OPERATIONAL_BINDING_MISMATCH');
  }

  if (binding.executionEnabled
    || binding.state !== 'contract_only'
    || runtime.implementationStatus !== 'contract_only'
    || runtime.productionAccess
    || toolProfile.toolNames.length !== 0
    || toolProfile.commandRefs.length !== 0
    || toolProfile.repositoryWrites
    || toolProfile.externalWrites
    || toolProfile.productionAccess
    || toolProfile.destructiveOperations
    || task.triggerMode !== 'manual'
    || task.sideEffectPolicy.mode !== 'forbidden'
    || task.sideEffectPolicy.allowedCommandRefs.length !== 0) {
    throw new AgentRunLedgerError('AGENT_RUN_SHADOW_BOUNDARY_VIOLATION');
  }

  const taskPayload = parseAgentContractSchema(task.inputSchema, parsedInput.taskInput);
  if (!taskPayload.success) throw new AgentRunLedgerError('AGENT_RUN_TASK_INPUT_INVALID');

  const run = await callRunRpc(
    resolveClient(rpcClient),
    'create_agent_run_shadow_v1',
    {
      p_task_id: parsedInput.taskId,
      p_tenant_id: parsedInput.tenantId,
      p_actor_id: parsedInput.actorId,
      p_actor_session_id: parsedInput.actorSessionId,
      p_role_key: role.roleKey,
      p_role_version: role.version,
      p_task_key: task.taskKey,
      p_task_contract_version: task.version,
      p_runtime_key: runtime.runtimeKey,
      p_runtime_version: runtime.version,
      p_tool_profile_key: toolProfile.toolProfileKey,
      p_tool_profile_version: toolProfile.version,
      p_provider_key: null,
      p_model_key: null,
      p_input_schema_hash: task.inputSchema.schemaHash,
      p_input_hash: hashAgentRunInput(taskPayload.data),
      p_trace_id: parsedInput.traceId,
      p_max_elapsed_ms: task.budgets.maxElapsedMs,
      p_max_turns: task.budgets.maxTurns,
      p_max_tool_calls: task.budgets.maxToolCalls,
      p_max_input_tokens: task.budgets.maxInputTokens,
      p_max_output_tokens: task.budgets.maxOutputTokens,
      p_max_cost_usd: task.budgets.maxCostUsd,
    },
    'AGENT_RUN_CREATE_FAILED',
  );
  if (!run) throw new AgentRunLedgerError('AGENT_RUN_CREATE_RETURNED_EMPTY');
  return run;
}

const LeaseOwnerSchema = OpaqueAgentReferenceSchema.refine((value) => value.length <= 120, {
  message: 'lease owner is too long',
});

export type AgentRunLease = {
  leaseToken: string;
  fencingToken: number;
  expiresAt: string;
};

export async function claimAgentRunShadow(
  input: {
    runId: string;
    tenantId: string | null;
    leaseOwner: string;
    leaseSeconds: number;
  },
  rpcClient?: AgentRunRpcClient,
): Promise<{ run: AgentRunShadowRow; lease: AgentRunLease } | null> {
  const parsed = z.object({
    runId: UUID,
    tenantId: UUID.nullable(),
    leaseOwner: LeaseOwnerSchema,
    leaseSeconds: z.number().int().min(30).max(900),
  }).strict().parse(input);
  const leaseToken = randomBytes(32).toString('base64url');
  const run = await callRunRpc(resolveClient(rpcClient), 'claim_agent_run_shadow_v1', {
    p_run_id: parsed.runId,
    p_tenant_id: parsed.tenantId,
    p_lease_owner: parsed.leaseOwner,
    p_lease_token: leaseToken,
    p_lease_seconds: parsed.leaseSeconds,
  }, 'AGENT_RUN_CLAIM_FAILED');
  if (!run) return null;
  if (!run.lease_expires_at || run.fencing_token < 1) {
    throw new AgentRunLedgerError('AGENT_RUN_INVALID_LEASE_RECEIPT');
  }
  return {
    run,
    lease: {
      leaseToken,
      fencingToken: run.fencing_token,
      expiresAt: run.lease_expires_at,
    },
  };
}

const LeaseMutationInputSchema = z.object({
  runId: UUID,
  tenantId: UUID.nullable(),
  leaseToken: z.string().min(32).max(256),
  fencingToken: z.number().int().positive(),
}).strict();

export async function transitionAgentRunShadow(
  input: z.input<typeof LeaseMutationInputSchema> & {
    expectedStatus: 'leased' | 'starting' | 'running' | 'waiting_approval';
    nextStatus: 'starting' | 'running' | 'waiting_approval';
  },
  rpcClient?: AgentRunRpcClient,
): Promise<AgentRunShadowRow | null> {
  const parsed = LeaseMutationInputSchema.extend({
    expectedStatus: z.enum(['leased', 'starting', 'running', 'waiting_approval']),
    nextStatus: z.enum(['starting', 'running', 'waiting_approval']),
  }).parse(input);
  const allowed = new Set([
    'leased:starting',
    'starting:running',
    'running:waiting_approval',
    'waiting_approval:running',
  ]);
  if (!allowed.has(`${parsed.expectedStatus}:${parsed.nextStatus}`)) {
    throw new AgentRunLedgerError('AGENT_RUN_INVALID_TRANSITION');
  }
  return callRunRpc(resolveClient(rpcClient), 'transition_agent_run_shadow_v1', {
    p_run_id: parsed.runId,
    p_tenant_id: parsed.tenantId,
    p_lease_token: parsed.leaseToken,
    p_fencing_token: parsed.fencingToken,
    p_expected_status: parsed.expectedStatus,
    p_next_status: parsed.nextStatus,
  }, 'AGENT_RUN_TRANSITION_FAILED');
}

export async function heartbeatAgentRunShadow(
  input: z.input<typeof LeaseMutationInputSchema> & { extendSeconds: number },
  rpcClient?: AgentRunRpcClient,
): Promise<AgentRunShadowRow | null> {
  const parsed = LeaseMutationInputSchema.extend({
    extendSeconds: z.number().int().min(30).max(900),
  }).parse(input);
  return callRunRpc(resolveClient(rpcClient), 'heartbeat_agent_run_shadow_v1', {
    p_run_id: parsed.runId,
    p_tenant_id: parsed.tenantId,
    p_lease_token: parsed.leaseToken,
    p_fencing_token: parsed.fencingToken,
    p_extend_seconds: parsed.extendSeconds,
  }, 'AGENT_RUN_HEARTBEAT_FAILED');
}

const RuntimeUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
}).strict();

export async function completeAgentRunShadow(
  input: z.input<typeof LeaseMutationInputSchema> & {
    outcome: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
    outputArtifactRef: string | null;
    outputHash: string | null;
    errorCode: string | null;
    usage: z.input<typeof RuntimeUsageSchema>;
  },
  rpcClient?: AgentRunRpcClient,
): Promise<AgentRunShadowRow | null> {
  const parsed = LeaseMutationInputSchema.extend({
    outcome: z.enum(['succeeded', 'failed', 'timed_out', 'cancelled']),
    outputArtifactRef: OpaqueAgentReferenceSchema.nullable(),
    outputHash: AgentSha256Schema.nullable(),
    errorCode: z.string().trim().min(2).max(120).nullable(),
    usage: RuntimeUsageSchema,
  }).superRefine((value, context) => {
    if ((value.outputArtifactRef === null) !== (value.outputHash === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['outputHash'], message: 'output ref/hash mismatch' });
    }
    if (value.outcome === 'succeeded' && (!value.outputHash || value.errorCode)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'invalid successful result' });
    }
    if (value.outcome !== 'succeeded' && !value.errorCode) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'failed result needs error' });
    }
  }).parse(input);

  return callRunRpc(resolveClient(rpcClient), 'complete_agent_run_shadow_v1', {
    p_run_id: parsed.runId,
    p_tenant_id: parsed.tenantId,
    p_lease_token: parsed.leaseToken,
    p_fencing_token: parsed.fencingToken,
    p_outcome: parsed.outcome,
    p_output_artifact_ref: parsed.outputArtifactRef,
    p_output_hash: parsed.outputHash,
    p_error_code: parsed.errorCode,
    p_input_tokens: parsed.usage.inputTokens,
    p_output_tokens: parsed.usage.outputTokens,
    p_tool_calls: parsed.usage.toolCalls,
    p_elapsed_ms: parsed.usage.elapsedMs,
    p_cost_usd: parsed.usage.costUsd,
  }, 'AGENT_RUN_COMPLETE_FAILED');
}

export async function orphanExpiredAgentRunShadow(
  input: { runId: string; tenantId: string | null; expectedFencingToken: number },
  rpcClient?: AgentRunRpcClient,
): Promise<AgentRunShadowRow | null> {
  const parsed = z.object({
    runId: UUID,
    tenantId: UUID.nullable(),
    expectedFencingToken: z.number().int().positive(),
  }).strict().parse(input);
  return callRunRpc(resolveClient(rpcClient), 'orphan_expired_agent_run_shadow_v1', {
    p_run_id: parsed.runId,
    p_tenant_id: parsed.tenantId,
    p_expected_fencing_token: parsed.expectedFencingToken,
  }, 'AGENT_RUN_ORPHAN_FAILED');
}

export type AgentTaskReconciliationSnapshot = {
  id: string;
  tenantId: string | null;
  agentType: string;
  specialistId: string | null;
  status: 'queued' | 'running' | 'frozen' | 'resumed' | 'done' | 'failed' | 'expired' | 'cancelled';
};

export type AgentTraceReconciliationSnapshot = {
  taskId: string | null;
  traceId: string;
  startedAt: string;
  endedAt: string | null;
};

export type AgentRunReconciliation = {
  authority: 'agent_tasks';
  outcome: 'matched' | 'pending' | 'mismatch';
  findings: string[];
};

const TASK_TERMINAL_STATUSES = new Set(['done', 'failed', 'expired', 'cancelled']);
const RUN_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled', 'orphaned']);

export function reconcileAgentRunShadow(input: {
  run: AgentRunShadowRow;
  task: AgentTaskReconciliationSnapshot | null;
  traces: AgentTraceReconciliationSnapshot[];
}): AgentRunReconciliation {
  const findings: string[] = [];
  const mismatches: string[] = [];
  const pending: string[] = [];
  const { run, task, traces } = input;

  if (!task) {
    mismatches.push('task_missing');
  } else {
    if (task.id !== run.task_id) mismatches.push('task_id_mismatch');
    if (task.tenantId !== run.tenant_id) mismatches.push('tenant_mismatch');
    if (task.agentType !== 'system' || task.specialistId !== run.role_key) {
      mismatches.push('legacy_role_binding_mismatch');
    }

    const runTerminal = RUN_TERMINAL_STATUSES.has(run.status);
    const taskTerminal = TASK_TERMINAL_STATUSES.has(task.status);
    if (runTerminal && taskTerminal) {
      const aligned = (run.status === 'succeeded' && task.status === 'done')
        || (run.status === 'failed' && task.status === 'failed')
        || (['timed_out', 'orphaned'].includes(run.status) && ['failed', 'expired'].includes(task.status))
        || (run.status === 'cancelled' && task.status === 'cancelled');
      if (!aligned) mismatches.push('terminal_outcome_mismatch');
    } else if (runTerminal !== taskTerminal) {
      pending.push('task_run_terminal_state_pending');
    } else {
      pending.push('task_run_both_nonterminal');
    }
  }

  if (!run.trace_id) {
    pending.push('trace_not_bound');
  } else {
    const sameTrace = traces.filter((trace) => trace.traceId === run.trace_id);
    if (sameTrace.length === 0) pending.push('trace_not_observed');
    if (sameTrace.some((trace) => trace.taskId !== run.task_id)) {
      mismatches.push('trace_task_mismatch');
    }
  }

  findings.push(...new Set([...mismatches, ...pending]));
  if (mismatches.length > 0) return { authority: 'agent_tasks', outcome: 'mismatch', findings };
  if (pending.length > 0) return { authority: 'agent_tasks', outcome: 'pending', findings };
  return { authority: 'agent_tasks', outcome: 'matched', findings };
}
