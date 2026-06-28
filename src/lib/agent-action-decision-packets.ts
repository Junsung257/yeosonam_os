import { supabaseAdmin } from '@/lib/supabase';
import {
  buildActionDecisionPacket,
  type AutopilotDecisionPacket,
  type DecisionRecommendation,
} from '@/lib/agent-action-registry';

export interface AgentActionForDecision {
  id: string;
  action_type: string;
  agent_type?: string | null;
  summary?: string | null;
  payload?: unknown;
  requested_by?: string | null;
  tenant_id?: string | null;
}

export interface PersistedDecisionPacket {
  id?: string;
  action_id: string;
  packet: AutopilotDecisionPacket;
  persisted: boolean;
  persistError?: string;
}

function dbErrorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? 'unknown error');
  }
  return String(error);
}

export function buildDecisionPacketForAction(action: AgentActionForDecision): AutopilotDecisionPacket {
  return buildActionDecisionPacket({
    actionType: action.action_type,
    payload: action.payload ?? {},
    summary: action.summary,
  });
}

export async function persistDecisionPacketForAction(
  action: AgentActionForDecision,
  params?: {
    source?: string;
    createdBy?: string;
  },
): Promise<PersistedDecisionPacket> {
  const packet = buildDecisionPacketForAction(action);

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_action_decision_packets')
      .insert({
        action_id: action.id,
        source: params?.source ?? 'jarvis_autopilot',
        action_type: packet.actionType,
        recommendation: packet.recommendation,
        risk_level: packet.riskLevel,
        approval_required: packet.requiresApproval,
        summary: packet.summary,
        packet,
        dry_run: packet.dryRun,
        evidence: packet.evidence,
        created_by: params?.createdBy ?? 'jarvis_autopilot',
      })
      .select('id')
      .maybeSingle();

    if (error) throw error;

    return {
      id: typeof data?.id === 'string' ? data.id : undefined,
      action_id: action.id,
      packet,
      persisted: true,
    };
  } catch (error) {
    return {
      action_id: action.id,
      packet,
      persisted: false,
      persistError: dbErrorMessage(error),
    };
  }
}

export async function getLatestDecisionPackets(actionIds: string[]): Promise<Record<string, AutopilotDecisionPacket>> {
  if (actionIds.length === 0) return {};

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_action_decision_packets')
      .select('action_id, packet, created_at')
      .in('action_id', actionIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const byAction: Record<string, AutopilotDecisionPacket> = {};
    for (const row of data ?? []) {
      const actionId = typeof row.action_id === 'string' ? row.action_id : null;
      if (!actionId || byAction[actionId]) continue;
      byAction[actionId] = row.packet as AutopilotDecisionPacket;
    }
    return byAction;
  } catch {
    return {};
  }
}

export async function recordDecisionPacketOutcome(params: {
  actionId: string;
  decision: Extract<DecisionRecommendation, 'approve' | 'reject'>;
  reviewedBy: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('agent_action_decision_packets')
      .select('id')
      .eq('action_id', params.actionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.id) return;

    await supabaseAdmin
      .from('agent_action_decision_packets')
      .update({
        decision: params.decision,
        decision_reason: params.reason ?? null,
        resolved_by: params.reviewedBy,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', data.id);
  } catch {
    // Decision packets are audit assistance. Do not break the core approval path.
  }
}
