import type { z } from 'zod';

import {
  CommandDefinitionSchema,
  RoleDefinitionSchema,
  RoleOperationalBindingSchema,
  RuntimeProfileSchema,
  TaskDefinitionSchema,
  ToolProfileSchema,
  type CommandDefinition,
  type RoleDefinition,
  type RoleOperationalBinding,
  type RuntimeProfile,
  type TaskDefinition,
  type ToolProfile,
} from './definitions';
import {
  CommandReceiptV1Schema,
  ReviewReceiptV1Schema,
  RuntimeResultV1Schema,
  TechnologyRadarEntryV1Schema,
  TechnologyScoutTaskInputV1Schema,
  WorkProductEnvelopeV1Schema,
  type AgentContractRef,
  type AgentSchemaRef,
} from './schemas';

type ContractSchema = z.ZodTypeAny;

export type AgentContractSchemaDefinition = {
  ref: AgentSchemaRef;
  schema: ContractSchema;
};

const schemaRef = (
  schemaKey: string,
  schemaVersion: string,
  schemaHash: string,
): AgentSchemaRef => Object.freeze({ schemaKey, schemaVersion, schemaHash });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const AGENT_CONTRACT_SCHEMA_REGISTRY = Object.freeze({
  technologyScoutTaskInput: {
    ref: schemaRef(
      'technology_scout_task_input',
      '1.0.0',
      'sha256:eaa48f597e687e7cbd3f10cb93b6440d11828bfc49c43dd75716b7e0453a37dc',
    ),
    schema: TechnologyScoutTaskInputV1Schema,
  },
  technologyRadarEntry: {
    ref: schemaRef(
      'technology_radar_entry',
      '1.0.0',
      'sha256:f4350e1b17743af736243b2a56a0958a203462b41f90766ed708a40e9158fe92',
    ),
    schema: TechnologyRadarEntryV1Schema,
  },
  workProductEnvelope: {
    ref: schemaRef(
      'work_product_envelope',
      '1.0.0',
      'sha256:2e291b4ad425c76a93e1ba6bb4d81483afbc23ba9b742e98c4dc314e38354b60',
    ),
    schema: WorkProductEnvelopeV1Schema,
  },
  reviewReceipt: {
    ref: schemaRef(
      'review_receipt',
      '1.0.0',
      'sha256:a13f8df910b3a82958b39ee960e7f61dc97a1d55591f9361a48d7a8a09de5ed3',
    ),
    schema: ReviewReceiptV1Schema,
  },
  runtimeResult: {
    ref: schemaRef(
      'runtime_result',
      '1.0.0',
      'sha256:d4dce411e44abe8c6827ca9901fb610753e25f60f396e021258e1b968d0a6c12',
    ),
    schema: RuntimeResultV1Schema,
  },
  commandReceipt: {
    ref: schemaRef(
      'command_receipt',
      '1.0.0',
      'sha256:54243e131689124dac8fcef0cb6e5804071f2e87e0953c0e3ceab0ce7388a0aa',
    ),
    schema: CommandReceiptV1Schema,
  },
} satisfies Record<string, AgentContractSchemaDefinition>);

const contractRef = (key: string, version: string): AgentContractRef => ({ key, version });

const technologyScoutRoleRef = contractRef('research.technology_scout', '1.0.0');
const technologyScoutTaskRef = contractRef('research.technology_scout', '1.0.0');
const codexRuntimeRef = contractRef('codex_subscription_worker', '1.0.0');
const noToolsRef = contractRef('research.technology_scout_no_tools', '1.0.0');

export const ROLE_REGISTRY = Object.freeze({
  'research.technology_scout': deepFreeze(RoleDefinitionSchema.parse({
    schemaVersion: 'role-definition-v1',
    roleKey: 'research.technology_scout',
    version: '1.0.0',
    title: 'Technology Scout',
    department: 'research',
    description: 'Produces review-only, evidence-backed technology assessments from public official sources.',
    defaultRisk: 'medium',
    allowedTaskRefs: [technologyScoutTaskRef],
    reviewerPolicy: {
      required: true,
      minimumReviews: 1,
      distinctRun: true,
      distinctActor: true,
      distinctSession: true,
      distinctRoleForRisk: ['high', 'critical'],
    },
    contractStatus: 'active',
  })),
} satisfies Record<string, RoleDefinition>);

export const RUNTIME_PROFILE_REGISTRY = Object.freeze({
  codex_subscription_worker: deepFreeze(RuntimeProfileSchema.parse({
    schemaVersion: 'runtime-profile-v1',
    runtimeKey: 'codex_subscription_worker',
    version: '1.0.0',
    title: 'Codex Subscription Worker Contract',
    runtimeKind: 'subscription_worker',
    implementationStatus: 'contract_only',
    capabilities: {
      health: true,
      start: true,
      cancel: true,
      resume: false,
      streaming: false,
      subagents: false,
    },
    credentialMode: 'task_bound_read_only',
    allowedDataClassifications: ['public'],
    productionAccess: false,
    rawPromptTrace: false,
    rawToolArgumentTrace: false,
    contractStatus: 'active',
  })),
} satisfies Record<string, RuntimeProfile>);

export const TOOL_PROFILE_REGISTRY = Object.freeze({
  'research.technology_scout_no_tools': deepFreeze(ToolProfileSchema.parse({
    schemaVersion: 'tool-profile-v1',
    toolProfileKey: 'research.technology_scout_no_tools',
    version: '1.0.0',
    title: 'Technology Scout Contract-only Tool Profile',
    accessMode: 'read_only',
    toolNames: [],
    commandRefs: [],
    networkHosts: [],
    credentialMode: 'none',
    repositoryWrites: false,
    externalWrites: false,
    productionAccess: false,
    destructiveOperations: false,
    contractStatus: 'active',
  })),
} satisfies Record<string, ToolProfile>);

export const COMMAND_REGISTRY = Object.freeze({} satisfies Record<string, CommandDefinition>);

export const TASK_REGISTRY = Object.freeze({
  'research.technology_scout': deepFreeze(TaskDefinitionSchema.parse({
    schemaVersion: 'task-definition-v1',
    taskKey: 'research.technology_scout',
    version: '1.0.0',
    title: 'Research a technology candidate',
    description: 'Creates a review-only Technology Radar candidate without installing or changing anything.',
    defaultRisk: 'medium',
    allowedRoleRefs: [technologyScoutRoleRef],
    allowedRuntimeRefs: [codexRuntimeRef],
    toolProfileRef: noToolsRef,
    inputSchema: AGENT_CONTRACT_SCHEMA_REGISTRY.technologyScoutTaskInput.ref,
    workProductEnvelopeSchema: AGENT_CONTRACT_SCHEMA_REGISTRY.workProductEnvelope.ref,
    workProductPayloadSchema: AGENT_CONTRACT_SCHEMA_REGISTRY.technologyRadarEntry.ref,
    triggerMode: 'manual',
    businessIdempotency: {
      required: true,
      strategy: 'caller_supplied_domain_key',
      retentionDays: 90,
    },
    budgets: {
      maxElapsedMs: 15 * 60 * 1_000,
      maxTurns: 8,
      maxToolCalls: 12,
      maxInputTokens: 80_000,
      maxOutputTokens: 12_000,
      maxCostUsd: null,
    },
    reviewerPolicy: {
      required: true,
      minimumReviews: 1,
      distinctRun: true,
      distinctActor: true,
      distinctSession: true,
      distinctRoleForRisk: ['high', 'critical'],
    },
    sideEffectPolicy: {
      mode: 'forbidden',
      allowedCommandRefs: [],
    },
    contractStatus: 'active',
  })),
} satisfies Record<string, TaskDefinition>);

export const ROLE_OPERATIONAL_BINDINGS = Object.freeze({
  'research.technology_scout': deepFreeze(RoleOperationalBindingSchema.parse({
    schemaVersion: 'role-operational-binding-v1',
    roleRef: technologyScoutRoleRef,
    legacyIdentity: {
      agentType: 'system',
      specialistId: 'research.technology_scout',
    },
    runtimeRef: codexRuntimeRef,
    toolProfileRef: noToolsRef,
    state: 'contract_only',
    executionEnabled: false,
  })),
} satisfies Record<string, RoleOperationalBinding>);

export type AgentContractRegistrySnapshot = {
  roles: Readonly<Record<string, RoleDefinition>>;
  tasks: Readonly<Record<string, TaskDefinition>>;
  runtimes: Readonly<Record<string, RuntimeProfile>>;
  toolProfiles: Readonly<Record<string, ToolProfile>>;
  commands: Readonly<Record<string, CommandDefinition>>;
  bindings: Readonly<Record<string, RoleOperationalBinding>>;
};

export const AGENT_CONTRACT_REGISTRY: AgentContractRegistrySnapshot = Object.freeze({
  roles: ROLE_REGISTRY,
  tasks: TASK_REGISTRY,
  runtimes: RUNTIME_PROFILE_REGISTRY,
  toolProfiles: TOOL_PROFILE_REGISTRY,
  commands: COMMAND_REGISTRY,
  bindings: ROLE_OPERATIONAL_BINDINGS,
});

function sameRef(left: AgentContractRef, right: { key: string; version: string }): boolean {
  return left.key === right.key && left.version === right.version;
}

function hasSchemaRef(ref: AgentSchemaRef): boolean {
  return Object.values(AGENT_CONTRACT_SCHEMA_REGISTRY).some((definition) => (
    definition.ref.schemaKey === ref.schemaKey
    && definition.ref.schemaVersion === ref.schemaVersion
    && definition.ref.schemaHash === ref.schemaHash
  ));
}

export function validateAgentContractRegistry(
  registry: AgentContractRegistrySnapshot = AGENT_CONTRACT_REGISTRY,
): string[] {
  const errors: string[] = [];

  for (const [key, role] of Object.entries(registry.roles)) {
    const parsed = RoleDefinitionSchema.safeParse(role);
    if (!parsed.success) errors.push(`ROLE_SCHEMA_INVALID:${key}`);
    if (key !== role.roleKey) errors.push(`ROLE_KEY_MISMATCH:${key}`);
    for (const taskRef of role.allowedTaskRefs) {
      const task = registry.tasks[taskRef.key];
      if (!task || !sameRef(taskRef, { key: task.taskKey, version: task.version })) {
        errors.push(`ROLE_TASK_REF_MISSING:${key}:${taskRef.key}@${taskRef.version}`);
      } else if (!task.allowedRoleRefs.some((roleRef) => sameRef(roleRef, {
        key: role.roleKey,
        version: role.version,
      }))) {
        errors.push(`ROLE_TASK_REF_NOT_RECIPROCAL:${key}:${taskRef.key}`);
      }
    }
  }

  for (const [key, task] of Object.entries(registry.tasks)) {
    const parsed = TaskDefinitionSchema.safeParse(task);
    if (!parsed.success) errors.push(`TASK_SCHEMA_INVALID:${key}`);
    if (key !== task.taskKey) errors.push(`TASK_KEY_MISMATCH:${key}`);
    for (const roleRef of task.allowedRoleRefs) {
      const role = registry.roles[roleRef.key];
      if (!role || !sameRef(roleRef, { key: role.roleKey, version: role.version })) {
        errors.push(`TASK_ROLE_REF_MISSING:${key}:${roleRef.key}@${roleRef.version}`);
      }
    }
    for (const runtimeRef of task.allowedRuntimeRefs) {
      const runtime = registry.runtimes[runtimeRef.key];
      if (!runtime || !sameRef(runtimeRef, { key: runtime.runtimeKey, version: runtime.version })) {
        errors.push(`TASK_RUNTIME_REF_MISSING:${key}:${runtimeRef.key}@${runtimeRef.version}`);
      }
    }
    const toolProfile = registry.toolProfiles[task.toolProfileRef.key];
    if (!toolProfile || !sameRef(task.toolProfileRef, {
      key: toolProfile.toolProfileKey,
      version: toolProfile.version,
    })) {
      errors.push(`TASK_TOOL_PROFILE_REF_MISSING:${key}`);
    }
    if (task.sideEffectPolicy.mode !== 'forbidden' || task.sideEffectPolicy.allowedCommandRefs.length !== 0) {
      errors.push(`TASK_SIDE_EFFECT_BOUNDARY_INVALID:${key}`);
    }
    for (const [label, schemaReference] of Object.entries({
      input: task.inputSchema,
      envelope: task.workProductEnvelopeSchema,
      payload: task.workProductPayloadSchema,
    })) {
      if (!hasSchemaRef(schemaReference)) errors.push(`TASK_SCHEMA_REF_MISSING:${key}:${label}`);
    }
  }

  for (const [key, runtime] of Object.entries(registry.runtimes)) {
    if (!RuntimeProfileSchema.safeParse(runtime).success) errors.push(`RUNTIME_SCHEMA_INVALID:${key}`);
    if (key !== runtime.runtimeKey) errors.push(`RUNTIME_KEY_MISMATCH:${key}`);
    if (runtime.implementationStatus !== 'contract_only'
      || runtime.allowedDataClassifications.length !== 1
      || runtime.allowedDataClassifications[0] !== 'public'
      || runtime.productionAccess
      || runtime.rawPromptTrace
      || runtime.rawToolArgumentTrace) {
      errors.push(`RUNTIME_FOUNDATION_BOUNDARY_INVALID:${key}`);
    }
  }

  for (const [key, profile] of Object.entries(registry.toolProfiles)) {
    if (!ToolProfileSchema.safeParse(profile).success) errors.push(`TOOL_PROFILE_SCHEMA_INVALID:${key}`);
    if (key !== profile.toolProfileKey) errors.push(`TOOL_PROFILE_KEY_MISMATCH:${key}`);
    if (profile.toolNames.length !== 0
      || profile.commandRefs.length !== 0
      || profile.networkHosts.length !== 0
      || profile.repositoryWrites
      || profile.externalWrites
      || profile.productionAccess
      || profile.destructiveOperations) {
      errors.push(`TOOL_PROFILE_FOUNDATION_BOUNDARY_INVALID:${key}`);
    }
  }

  for (const [key, command] of Object.entries(registry.commands)) {
    if (!CommandDefinitionSchema.safeParse(command).success) errors.push(`COMMAND_SCHEMA_INVALID:${key}`);
    if (key !== command.commandKey) errors.push(`COMMAND_KEY_MISMATCH:${key}`);
    if (!hasSchemaRef(command.argumentsSchema) || !hasSchemaRef(command.receiptSchema)) {
      errors.push(`COMMAND_SCHEMA_REF_MISSING:${key}`);
    }
  }

  for (const [key, binding] of Object.entries(registry.bindings)) {
    if (!RoleOperationalBindingSchema.safeParse(binding).success) errors.push(`BINDING_SCHEMA_INVALID:${key}`);
    const role = registry.roles[binding.roleRef.key];
    const runtime = registry.runtimes[binding.runtimeRef.key];
    const toolProfile = registry.toolProfiles[binding.toolProfileRef.key];
    if (key !== binding.roleRef.key || !role || !sameRef(binding.roleRef, { key: role.roleKey, version: role.version })) {
      errors.push(`BINDING_ROLE_REF_MISSING:${key}`);
    }
    if (!runtime || !sameRef(binding.runtimeRef, { key: runtime.runtimeKey, version: runtime.version })) {
      errors.push(`BINDING_RUNTIME_REF_MISSING:${key}`);
    }
    if (!toolProfile || !sameRef(binding.toolProfileRef, {
      key: toolProfile.toolProfileKey,
      version: toolProfile.version,
    })) {
      errors.push(`BINDING_TOOL_PROFILE_REF_MISSING:${key}`);
    }
    if (binding.state !== 'contract_only' || binding.executionEnabled) {
      errors.push(`BINDING_FOUNDATION_BOUNDARY_INVALID:${key}`);
    }
  }

  if (Object.keys(registry.commands).length !== 0) errors.push('FOUNDATION_COMMAND_REGISTRY_MUST_BE_EMPTY');
  return [...new Set(errors)];
}

export function getRoleDefinition(roleKey: string): RoleDefinition | null {
  return ROLE_REGISTRY[roleKey as keyof typeof ROLE_REGISTRY] ?? null;
}

export function getTaskDefinition(taskKey: string): TaskDefinition | null {
  return TASK_REGISTRY[taskKey as keyof typeof TASK_REGISTRY] ?? null;
}

export function getRuntimeProfile(runtimeKey: string): RuntimeProfile | null {
  return RUNTIME_PROFILE_REGISTRY[runtimeKey as keyof typeof RUNTIME_PROFILE_REGISTRY] ?? null;
}

export function getToolProfile(toolProfileKey: string): ToolProfile | null {
  return TOOL_PROFILE_REGISTRY[toolProfileKey as keyof typeof TOOL_PROFILE_REGISTRY] ?? null;
}

export function getCommandDefinition(commandKey: string): CommandDefinition | null {
  const commands: Readonly<Record<string, CommandDefinition>> = COMMAND_REGISTRY;
  return commands[commandKey] ?? null;
}

export function getContractSchema(schemaKey: string): AgentContractSchemaDefinition | null {
  return Object.values(AGENT_CONTRACT_SCHEMA_REGISTRY)
    .find((definition) => definition.ref.schemaKey === schemaKey) ?? null;
}

export function parseAgentContractSchema(
  ref: AgentSchemaRef,
  input: unknown,
): { success: true; data: unknown } | { success: false; issues: string[] } {
  const definition = Object.values(AGENT_CONTRACT_SCHEMA_REGISTRY).find((candidate) => (
    candidate.ref.schemaKey === ref.schemaKey
    && candidate.ref.schemaVersion === ref.schemaVersion
    && candidate.ref.schemaHash === ref.schemaHash
  ));
  if (!definition) return { success: false, issues: ['SCHEMA_REF_NOT_REGISTERED'] };
  const parsed = definition.schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}:${issue.code}`),
    };
  }
  return { success: true, data: parsed.data };
}
