import { z } from 'zod';

import {
  AgentContractKeySchema,
  AgentContractVersionSchema,
  AgentSha256Schema,
  OpaqueAgentReferenceSchema,
  RuntimeResultV1Schema,
  type RuntimeResultV1,
} from '@/lib/agent/contracts';

const UUID = z.string().uuid();

export const RuntimeBudgetSchema = z.object({
  maxElapsedMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
  maxTurns: z.number().int().positive().max(100),
  maxToolCalls: z.number().int().nonnegative().max(500),
  maxInputTokens: z.number().int().positive().max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(500_000),
  maxCostUsd: z.number().nonnegative().nullable(),
}).strict();

export const RuntimeStartInputSchema = z.object({
  runId: UUID,
  taskId: UUID,
  tenantId: UUID.nullable(),
  roleKey: AgentContractKeySchema,
  roleVersion: AgentContractVersionSchema,
  taskKey: AgentContractKeySchema,
  taskContractVersion: AgentContractVersionSchema,
  runtimeKey: AgentContractKeySchema,
  runtimeVersion: AgentContractVersionSchema,
  toolProfileKey: AgentContractKeySchema,
  toolProfileVersion: AgentContractVersionSchema,
  inputArtifactRefs: z.array(OpaqueAgentReferenceSchema).min(1).max(100),
  taskInput: z.unknown(),
  workspaceRoot: z.string().trim().min(1).max(1_024),
  capabilityToken: z.string().min(32).max(512),
  budgets: RuntimeBudgetSchema,
}).strict();

export const RuntimeCapabilityClaimsSchema = z.object({
  mode: z.literal('shadow_read_only'),
  runId: UUID,
  taskId: UUID,
  tenantId: UUID.nullable(),
  roleKey: z.literal('research.technology_scout'),
  taskKey: z.literal('research.technology_scout'),
  dataClassification: z.literal('public'),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  readableRoots: z.array(z.string().trim().min(1).max(1_024)).min(1).max(10),
}).strict();

export type RuntimeStartInput = z.infer<typeof RuntimeStartInputSchema>;
export type RuntimeCapabilityClaims = z.infer<typeof RuntimeCapabilityClaimsSchema>;

export type RuntimeHealth = {
  runtimeKey: 'codex_subscription_worker';
  runtimeVersion: '1.0.0';
  status: 'healthy' | 'unavailable';
  checkedAt: string;
  detailCode: 'CHATGPT_SUBSCRIPTION_READY' | 'RUNTIME_UNAVAILABLE';
};

export type RuntimeCancelResult = {
  runId: string;
  outcome: 'interrupt_requested' | 'not_running' | 'failed';
  errorCode: string | null;
};

export interface AgentRuntimeAdapter {
  health(): Promise<RuntimeHealth>;
  start(input: RuntimeStartInput): Promise<RuntimeResultV1>;
  cancel?(runId: string): Promise<RuntimeCancelResult>;
}

export interface RuntimeCapabilityVerifier {
  verify(input: {
    capabilityToken: string;
    runId: string;
    taskId: string;
    tenantId: string | null;
  }): Promise<RuntimeCapabilityClaims>;
}

export interface RuntimeArtifactSink {
  persistShadowOutput(input: {
    runId: string;
    taskId: string;
    tenantId: string | null;
    taskKey: 'research.technology_scout';
    payload: unknown;
  }): Promise<{
    outputArtifactRef: string;
    outputHash: string;
  }>;
}

export const RuntimePublicInputArtifactSchema = z.object({
  artifactRef: OpaqueAgentReferenceSchema,
  contentHash: AgentSha256Schema,
  dataClassification: z.literal('public'),
  content: z.string().min(1).max(100_000),
}).strict();

export type RuntimePublicInputArtifact = z.infer<typeof RuntimePublicInputArtifactSchema>;

export interface RuntimeInputArtifactSource {
  readPublicArtifacts(input: {
    runId: string;
    taskId: string;
    tenantId: string | null;
    artifactRefs: string[];
  }): Promise<RuntimePublicInputArtifact[]>;
}

export function parseRuntimeArtifactReceipt(input: unknown): {
  outputArtifactRef: string;
  outputHash: string;
} {
  return z.object({
    outputArtifactRef: OpaqueAgentReferenceSchema,
    outputHash: AgentSha256Schema,
  }).strict().parse(input);
}

export function parseRuntimeResult(input: unknown): RuntimeResultV1 {
  return RuntimeResultV1Schema.parse(input);
}
