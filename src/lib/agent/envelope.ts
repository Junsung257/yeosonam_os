export type AgentPerformative = 'request' | 'propose' | 'inform' | 'approve' | 'reject';

export type AgentRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'frozen'
  | 'resumed'
  | 'done'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface AgentTaskContext {
  userMessage?: string;
  normalizedIntent?: string;
  guardrailFlags?: string[];
  toolPlan?: Array<{ tool: string; reason: string }>;
  notes?: string[];
  [key: string]: unknown;
}

export interface AgentTaskEnvelope {
  correlationId: string;
  sessionId?: string;
  tenantId?: string;
  affiliateId?: string;
  source: 'jarvis_stream' | 'jarvis_v1' | 'qa_chat' | 'cron' | 'manual';
  agentType: 'operations' | 'products' | 'finance' | 'marketing' | 'sales' | 'system';
  specialistId?: string;
  performative: AgentPerformative;
  riskLevel: AgentRiskLevel;
  status: AgentTaskStatus;
  idempotencyKey?: string;
  taskContext: AgentTaskContext;
  createdBy: string;
  assignedTo?: string;
}

export function createDefaultEnvelope(
  input: Pick<
    AgentTaskEnvelope,
    'correlationId' | 'source' | 'agentType' | 'taskContext' | 'createdBy'
  > &
    Partial<
      Pick<
        AgentTaskEnvelope,
        'sessionId' | 'tenantId' | 'affiliateId' | 'specialistId' | 'idempotencyKey'
      >
    >,
): AgentTaskEnvelope {
  return {
    correlationId: input.correlationId,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    affiliateId: input.affiliateId,
    source: input.source,
    agentType: input.agentType,
    specialistId: input.specialistId,
    performative: 'request',
    riskLevel: 'low',
    status: 'queued',
    idempotencyKey: input.idempotencyKey,
    taskContext: input.taskContext,
    createdBy: input.createdBy,
  };
}
