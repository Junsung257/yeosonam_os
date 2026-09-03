import {
  ACTION_REGISTRY,
  getActionRegistryEntry,
  type ActionRegistryEntry,
} from '@/lib/agent-action-registry';
import type { AgentType } from '@/lib/jarvis/types';

import { ROLE_OPERATIONAL_BINDINGS } from './registry';

export type LegacyAgentIdentity = {
  agentType: AgentType;
  specialistId: string;
};

export type LegacyActionCommandView = {
  source: 'legacy_agent_action_registry';
  actionType: string;
  agentType: AgentType;
  riskLevel: ActionRegistryEntry['riskLevel'];
  requiresApproval: boolean;
  agentOfficeCommandRegistered: false;
  agentOfficeExecutionAllowed: false;
};

export function toLegacyAgentIdentity(roleKey: string): LegacyAgentIdentity | null {
  const binding = ROLE_OPERATIONAL_BINDINGS[roleKey as keyof typeof ROLE_OPERATIONAL_BINDINGS];
  if (!binding) return null;
  return { ...binding.legacyIdentity };
}

export function fromLegacyAgentIdentity(identity: LegacyAgentIdentity): string | null {
  const match = Object.values(ROLE_OPERATIONAL_BINDINGS).find((binding) => (
    binding.legacyIdentity.agentType === identity.agentType
    && binding.legacyIdentity.specialistId === identity.specialistId
  ));
  return match?.roleRef.key ?? null;
}

function toLegacyActionCommandView(entry: ActionRegistryEntry): LegacyActionCommandView {
  return Object.freeze({
    source: 'legacy_agent_action_registry',
    actionType: entry.actionType,
    agentType: entry.agentType,
    riskLevel: entry.riskLevel,
    requiresApproval: entry.requiresApproval,
    agentOfficeCommandRegistered: false,
    agentOfficeExecutionAllowed: false,
  });
}

export function getLegacyActionCommandView(actionType: string): LegacyActionCommandView | null {
  const entry = getActionRegistryEntry(actionType);
  return entry ? toLegacyActionCommandView(entry) : null;
}

export function listLegacyActionCommandViews(): LegacyActionCommandView[] {
  return Object.values(ACTION_REGISTRY).map(toLegacyActionCommandView);
}
