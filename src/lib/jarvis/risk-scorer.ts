import type { AgentRiskLevel } from '@/lib/agent/envelope';

const CRITICAL_PATTERNS = [
  /환불/i,
  /결제\s*취소/i,
  /강제\s*취소/i,
  /카드\s*취소/i,
  /계좌\s*변경/i,
];

const HIGH_PATTERNS = [
  /가격\s*변경/i,
  /할인\s*적용/i,
  /수수료/i,
  /정산/i,
  /재고\s*차감/i,
  /좌석\s*확정/i,
];

const MEDIUM_PATTERNS = [/예약\s*상태/i, /에스컬레이션/i, /재확인/i, /랜드사/i];

export interface ScoreRiskInput {
  message: string;
  toolPlan?: string[];
  hasMoneyMutation?: boolean;
  hasPolicyMutation?: boolean;
}

export function scoreRiskLevel(input: ScoreRiskInput): AgentRiskLevel {
  const text = `${input.message} ${(input.toolPlan ?? []).join(' ')}`.trim();

  if (input.hasMoneyMutation || input.hasPolicyMutation) return 'critical';
  if (CRITICAL_PATTERNS.some((re) => re.test(text))) return 'critical';
  if (HIGH_PATTERNS.some((re) => re.test(text))) return 'high';
  if (MEDIUM_PATTERNS.some((re) => re.test(text))) return 'medium';
  return 'low';
}

export function requiresApproval(riskLevel: AgentRiskLevel): boolean {
  return riskLevel === 'high' || riskLevel === 'critical';
}
