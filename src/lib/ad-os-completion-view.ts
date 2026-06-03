export type CompletionAuditStatus = 'ready' | 'needs_attention' | 'blocked';
export type CompletionRequirementStatus = 'pass' | 'warn' | 'fail';
export type CompletionTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface CompletionRequirementView {
  id: string;
  label: string;
  status: CompletionRequirementStatus;
  evidence: string;
  next_action: string;
}

export interface CompletionAuditView {
  status: CompletionAuditStatus;
  readiness_score: number;
  passed: number;
  warnings: number;
  failed: number;
  top_blocker: string;
  next_action: string;
  requirements?: CompletionRequirementView[];
}

export const COMPLETION_REQUIREMENT_EXTERNAL_WRITE_ZERO = 'external_write_zero';
export const COMPLETION_REQUIREMENT_FULL_AUTO_DEFAULT_OFF = 'full_auto_default_off';
export const COMPLETION_REQUIREMENT_TENANT_BUDGET_GUARDRAILS = 'tenant_budget_guardrails';
export const COMPLETION_REQUIREMENT_INCIDENT_RESPONSE_CLEAR = 'incident_response_clear';

export const OPERATOR_CRITICAL_COMPLETION_REQUIREMENTS = [
  COMPLETION_REQUIREMENT_EXTERNAL_WRITE_ZERO,
  COMPLETION_REQUIREMENT_FULL_AUTO_DEFAULT_OFF,
  COMPLETION_REQUIREMENT_TENANT_BUDGET_GUARDRAILS,
  COMPLETION_REQUIREMENT_INCIDENT_RESPONSE_CLEAR,
] as const;

export function completionAuditTone(status?: CompletionAuditStatus): CompletionTone {
  if (status === 'ready') return 'good';
  if (status === 'blocked') return 'bad';
  if (status === 'needs_attention') return 'warn';
  return 'neutral';
}

export function selectOperatorCriticalRequirements(
  audit: CompletionAuditView | null | undefined,
): CompletionRequirementView[] {
  const requirements = audit?.requirements ?? [];
  const critical = requirements.filter((requirement) =>
    OPERATOR_CRITICAL_COMPLETION_REQUIREMENTS.includes(
      requirement.id as (typeof OPERATOR_CRITICAL_COMPLETION_REQUIREMENTS)[number],
    ),
  );

  return critical.slice(0, OPERATOR_CRITICAL_COMPLETION_REQUIREMENTS.length);
}

export function buildCompletionFallbackRequirements(error?: string | null): CompletionRequirementView[] {
  return [{
    id: 'completion_evidence_unavailable',
    label: 'Audit evidence',
    status: error ? 'fail' : 'warn',
    evidence: error || 'No completion requirements returned yet.',
    next_action: 'Recover /api/admin/ad-os/summary and /api/admin/ad-os/completion-audit.',
  }];
}
