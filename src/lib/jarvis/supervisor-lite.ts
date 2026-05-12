import { createDefaultEnvelope } from '@/lib/agent/envelope';
import { scoreRiskLevel } from '@/lib/jarvis/risk-scorer';
import { resolveSpecialist } from '@/lib/jarvis/orchestration';
import type { AgentType, JarvisContext } from '@/lib/jarvis/types';

export interface SupervisorDecision {
  agentType: AgentType;
  specialistId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  envelope: ReturnType<typeof createDefaultEnvelope>;
}

export function supervisorLite(input: {
  message: string;
  sessionId?: string;
  tenantId?: string;
  affiliateId?: string | null;
  agentType: AgentType;
  ctx: JarvisContext;
  correlationId: string;
  source: 'jarvis_stream' | 'jarvis_v1' | 'qa_chat';
}) {
  const specialist = resolveSpecialist(input.agentType, input.message, input.ctx);
  const riskLevel = scoreRiskLevel({ message: input.message });
  const envelope = createDefaultEnvelope({
    correlationId: input.correlationId,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    affiliateId: input.affiliateId ?? undefined,
    source: input.source,
    agentType: input.agentType,
    specialistId: specialist.specialistId,
    createdBy: 'system:supervisor-lite',
    taskContext: {
      userMessage: input.message,
      normalizedIntent: specialist.specialistId,
      notes: [`routing_method:${specialist.method}`],
    },
  });
  envelope.riskLevel = riskLevel;
  return {
    agentType: input.agentType,
    specialistId: specialist.specialistId,
    riskLevel,
    envelope,
  } satisfies SupervisorDecision;
}

