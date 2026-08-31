import { supabaseAdmin } from '@/lib/supabase';
import type { AgentTaskEnvelope, AgentTaskStatus } from '@/lib/agent/envelope';
import { canTransitionTask } from '@/lib/agent/task-machine';
import { resolveAgentApprovalExpiry } from '@/lib/agent/lifecycle-policy';

export async function createAgentTask(envelope: AgentTaskEnvelope) {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .insert({
      correlation_id: envelope.correlationId,
      session_id: envelope.sessionId ?? null,
      tenant_id: envelope.tenantId ?? null,
      affiliate_id: envelope.affiliateId ?? null,
      source: envelope.source,
      agent_type: envelope.agentType,
      specialist_id: envelope.specialistId ?? null,
      performative: envelope.performative,
      risk_level: envelope.riskLevel,
      status: envelope.status,
      idempotency_key: envelope.idempotencyKey ?? null,
      task_context: envelope.taskContext,
      created_by: envelope.createdBy,
      assigned_to: envelope.assignedTo ?? null,
    })
    .select('id, status')
    .single();
  if (error) throw error;
  return data;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code) === '23505';
}

export async function createAgentTaskIdempotently(envelope: AgentTaskEnvelope) {
  if (!envelope.idempotencyKey) {
    throw new Error('idempotency key is required');
  }

  try {
    const created = await createAgentTask(envelope);
    return { ...created, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const { data, error: readError } = await supabaseAdmin
      .from('agent_tasks')
      .select('id, status')
      .eq('idempotency_key', envelope.idempotencyKey)
      .maybeSingle();
    if (readError) throw readError;
    if (!data) throw error;
    return { ...data, duplicate: true };
  }
}

export async function transitionAgentTask(
  taskId: string,
  from: AgentTaskStatus,
  to: AgentTaskStatus,
  patch?: Record<string, unknown>,
) {
  if (!canTransitionTask(from, to)) {
    throw new Error(`유효하지 않은 작업 전이: ${from} -> ${to}`);
  }

  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .update({
      status: to,
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', from)
    .select('id, status')
    .single();

  if (error) throw error;
  return data;
}

export async function createApprovalRequest(params: {
  taskId: string;
  actionId?: string | null;
  reason: string;
  requestedBy: string;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_approvals')
    .insert({
      task_id: params.taskId,
      action_id: params.actionId ?? null,
      status: 'pending',
      reason: params.reason,
      requested_by: params.requestedBy,
      expires_at: resolveAgentApprovalExpiry(params.expiresAt),
      metadata: params.metadata ?? {},
    })
    .select('id, status')
    .single();

  if (error) throw error;
  return data;
}

export async function recordAgentIncident(params: {
  correlationId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  tenantId?: string | null;
  severity: 'info' | 'warn' | 'error' | 'critical';
  category:
    | 'hallucination'
    | 'policy_violation'
    | 'prompt_injection'
    | 'tool_validation'
    | 'timeout'
    | 'rate_limit'
    | 'manual_handoff'
    | 'unknown';
  message: string;
  details?: Record<string, unknown>;
  detectedBy?: string;
}) {
  await supabaseAdmin.from('agent_incidents').insert({
    correlation_id: params.correlationId ?? null,
    task_id: params.taskId ?? null,
    session_id: params.sessionId ?? null,
    tenant_id: params.tenantId ?? null,
    severity: params.severity,
    category: params.category,
    message: params.message,
    details: params.details ?? {},
    detected_by: params.detectedBy ?? 'system',
  });
}
