import type { AgentType, RiskLevel } from '@/lib/jarvis/types'

// re-export for convenience
export type { AgentType, RiskLevel }

// ── 상태/타입 정의 ──────────────────────────────────────────────────
export type AgentActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'expired'

export type ActionPriority = 'low' | 'normal' | 'high' | 'critical'

// ── 전이 정의 ───────────────────────────────────────────────────────
export interface ActionTransitionDef {
  to: AgentActionStatus
  label: string
}

export const ALLOWED_TRANSITIONS: Record<string, ActionTransitionDef[]> = {
  pending: [
    { to: 'approved', label: '승인' },
    { to: 'rejected', label: '반려' },
    { to: 'expired', label: '만료' },
  ],
  approved: [
    { to: 'executed', label: '실행 완료' },
    { to: 'failed', label: '실행 실패' },
  ],
  failed: [
    { to: 'pending', label: '재시도' },
  ],
  rejected: [],
  executed: [],
  expired: [],
}

// ── 전이 검증 ───────────────────────────────────────────────────────
export function isValidTransition(from: string, to: string): boolean {
  const transitions = ALLOWED_TRANSITIONS[from] ?? []
  return transitions.some(t => t.to === to)
}

// ── 라벨 ────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  executed: '실행완료',
  failed: '실패',
  expired: '만료',
}

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

// ── 배지 클래스 ─────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-blue-50 text-blue-600',
  rejected: 'bg-red-50 text-red-600',
  executed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  expired: 'bg-slate-100 text-slate-500',
}

export function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600'
}

const AGENT_LABELS: Record<string, string> = {
  operations: '운영',
  sales: '영업',
  marketing: '마케팅',
  finance: '재무',
  products: '상품',
  system: '시스템',
}

export function getAgentTypeLabel(agentType: string): string {
  return AGENT_LABELS[agentType] ?? agentType
}

const AGENT_BADGE: Record<string, string> = {
  operations: 'bg-blue-50 text-blue-600',
  sales: 'bg-purple-50 text-purple-600',
  marketing: 'bg-pink-50 text-pink-600',
  finance: 'bg-emerald-50 text-emerald-600',
  products: 'bg-cyan-50 text-cyan-600',
  system: 'bg-slate-100 text-slate-600',
}

export function getAgentTypeBadgeClass(agentType: string): string {
  return AGENT_BADGE[agentType] ?? 'bg-slate-100 text-slate-600'
}

const PRIORITY_LABELS: Record<string, string> = {
  low: '낮음',
  normal: '보통',
  high: '높음',
  critical: '긴급',
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority
}

const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-slate-50 text-slate-500',
  normal: 'bg-blue-50 text-blue-600',
  high: 'bg-orange-50 text-orange-600',
  critical: 'bg-red-50 text-red-600',
}

export function getPriorityBadgeClass(priority: string): string {
  return PRIORITY_BADGE[priority] ?? 'bg-slate-100 text-slate-600'
}
