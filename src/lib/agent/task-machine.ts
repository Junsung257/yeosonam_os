import type { AgentTaskStatus } from '@/lib/agent/envelope';

const ALLOWED: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  queued: ['running', 'cancelled', 'expired'],
  running: ['frozen', 'done', 'failed', 'expired', 'cancelled'],
  frozen: ['resumed', 'cancelled', 'expired'],
  resumed: ['running', 'done', 'failed', 'expired', 'cancelled'],
  done: [],
  failed: ['queued', 'cancelled'],
  expired: [],
  cancelled: [],
};

export function canTransitionTask(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

