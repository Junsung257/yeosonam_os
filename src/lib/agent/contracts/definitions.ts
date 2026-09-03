import { z } from 'zod';

import {
  AgentContractKeySchema,
  AgentContractRefSchema,
  AgentContractVersionSchema,
  AgentDepartmentSchema,
  AgentRiskLevelSchema,
  AgentSchemaRefSchema,
} from './schemas';

const BoundedBudgetSchema = z.object({
  maxElapsedMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
  maxTurns: z.number().int().positive().max(100),
  maxToolCalls: z.number().int().nonnegative().max(500),
  maxInputTokens: z.number().int().positive().max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(500_000),
  maxCostUsd: z.number().nonnegative().nullable(),
}).strict();

const ReviewerPolicySchema = z.object({
  required: z.boolean(),
  minimumReviews: z.number().int().min(0).max(10),
  distinctRun: z.literal(true),
  distinctActor: z.literal(true),
  distinctSession: z.literal(true),
  distinctRoleForRisk: z.array(z.enum(['low', 'medium', 'high', 'critical'])),
}).strict().superRefine((value, context) => {
  if (value.required && value.minimumReviews < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minimumReviews'],
      message: 'required review must request at least one receipt',
    });
  }
});

export const RoleDefinitionSchema = z.object({
  schemaVersion: z.literal('role-definition-v1'),
  roleKey: AgentContractKeySchema,
  version: AgentContractVersionSchema,
  title: z.string().trim().min(1).max(160),
  department: AgentDepartmentSchema,
  description: z.string().trim().min(1).max(1_000),
  defaultRisk: AgentRiskLevelSchema,
  allowedTaskRefs: z.array(AgentContractRefSchema).min(1).max(100),
  reviewerPolicy: ReviewerPolicySchema,
  contractStatus: z.enum(['active', 'deprecated']),
}).strict();

export const TaskDefinitionSchema = z.object({
  schemaVersion: z.literal('task-definition-v1'),
  taskKey: AgentContractKeySchema,
  version: AgentContractVersionSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000),
  defaultRisk: AgentRiskLevelSchema,
  allowedRoleRefs: z.array(AgentContractRefSchema).min(1).max(100),
  allowedRuntimeRefs: z.array(AgentContractRefSchema).min(1).max(50),
  toolProfileRef: AgentContractRefSchema,
  inputSchema: AgentSchemaRefSchema,
  workProductEnvelopeSchema: AgentSchemaRefSchema,
  workProductPayloadSchema: AgentSchemaRefSchema,
  triggerMode: z.literal('manual'),
  businessIdempotency: z.object({
    required: z.literal(true),
    strategy: z.literal('caller_supplied_domain_key'),
    retentionDays: z.number().int().min(1).max(3650),
  }).strict(),
  budgets: BoundedBudgetSchema,
  reviewerPolicy: ReviewerPolicySchema,
  sideEffectPolicy: z.object({
    mode: z.literal('forbidden'),
    allowedCommandRefs: z.array(AgentContractRefSchema).length(0),
  }).strict(),
  contractStatus: z.enum(['active', 'deprecated']),
}).strict();

export const RuntimeProfileSchema = z.object({
  schemaVersion: z.literal('runtime-profile-v1'),
  runtimeKey: AgentContractKeySchema,
  version: AgentContractVersionSchema,
  title: z.string().trim().min(1).max(160),
  runtimeKind: z.enum(['subscription_worker', 'provider_api', 'deterministic']),
  implementationStatus: z.enum(['contract_only', 'available']),
  capabilities: z.object({
    health: z.boolean(),
    start: z.boolean(),
    cancel: z.boolean(),
    resume: z.literal(false),
    streaming: z.literal(false),
    subagents: z.literal(false),
  }).strict(),
  credentialMode: z.enum(['none', 'task_bound_read_only']),
  allowedDataClassifications: z.array(z.enum(['public', 'internal', 'confidential', 'restricted'])).min(1),
  productionAccess: z.literal(false),
  rawPromptTrace: z.literal(false),
  rawToolArgumentTrace: z.literal(false),
  contractStatus: z.enum(['active', 'deprecated']),
}).strict();

export const ToolProfileSchema = z.object({
  schemaVersion: z.literal('tool-profile-v1'),
  toolProfileKey: AgentContractKeySchema,
  version: AgentContractVersionSchema,
  title: z.string().trim().min(1).max(160),
  accessMode: z.literal('read_only'),
  toolNames: z.array(AgentContractKeySchema),
  commandRefs: z.array(AgentContractRefSchema).length(0),
  networkHosts: z.array(z.string().trim().min(1).max(253)),
  credentialMode: z.literal('none'),
  repositoryWrites: z.literal(false),
  externalWrites: z.literal(false),
  productionAccess: z.literal(false),
  destructiveOperations: z.literal(false),
  contractStatus: z.enum(['active', 'deprecated']),
}).strict();

export const CommandDefinitionSchema = z.object({
  schemaVersion: z.literal('command-definition-v1'),
  commandKey: AgentContractKeySchema,
  version: AgentContractVersionSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000),
  riskLevel: AgentRiskLevelSchema,
  targetTypes: z.array(AgentContractKeySchema).min(1).max(30),
  argumentsSchema: AgentSchemaRefSchema,
  receiptSchema: AgentSchemaRefSchema,
  requiresApproval: z.literal(true),
  idempotency: z.object({
    required: z.literal(true),
    strategy: z.literal('domain_derived'),
  }).strict(),
  executorBinding: z.literal('unbound'),
  officeExecution: z.literal('forbidden'),
  contractStatus: z.enum(['active', 'deprecated']),
}).strict();

export const RoleOperationalBindingSchema = z.object({
  schemaVersion: z.literal('role-operational-binding-v1'),
  roleRef: AgentContractRefSchema,
  legacyIdentity: z.object({
    agentType: z.enum(['operations', 'products', 'finance', 'marketing', 'sales', 'system']),
    specialistId: z.string().trim().min(1).max(120),
  }).strict(),
  runtimeRef: AgentContractRefSchema,
  toolProfileRef: AgentContractRefSchema,
  state: z.literal('contract_only'),
  executionEnabled: z.literal(false),
}).strict();

export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export type ToolProfile = z.infer<typeof ToolProfileSchema>;
export type CommandDefinition = z.infer<typeof CommandDefinitionSchema>;
export type RoleOperationalBinding = z.infer<typeof RoleOperationalBindingSchema>;
