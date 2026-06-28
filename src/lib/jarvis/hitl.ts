import {
  ACTION_REGISTRY,
  getActionRegistryEntry,
  getJarvisMutatingToolNames,
} from '@/lib/agent-action-registry';
import type { RiskLevel } from './types';

// Runtime HITL list is derived from the central action registry.
export const HITL_TOOLS: Record<string, { riskLevel: RiskLevel; description: string }> =
  Object.fromEntries(
    getJarvisMutatingToolNames()
      .map((toolName) => {
        const entry = getActionRegistryEntry(toolName);
        if (!entry || !entry.requiresApproval) return null;
        return [
          toolName,
          {
            riskLevel: entry.riskLevel as RiskLevel,
            description: entry.description,
          },
        ];
      })
      .filter((item): item is [string, { riskLevel: RiskLevel; description: string }] => item !== null),
  );

export function requiresHITL(toolName: string): boolean {
  return toolName in HITL_TOOLS;
}

export function getHITLInfo(toolName: string) {
  return HITL_TOOLS[toolName] ?? null;
}

export function getRiskColor(level: RiskLevel): string {
  return { low: 'green', medium: 'amber', high: 'red', critical: 'red' }[level];
}

export function getRegisteredActionCount(): number {
  return Object.keys(ACTION_REGISTRY).length;
}
