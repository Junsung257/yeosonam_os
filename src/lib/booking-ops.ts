import type { InboxTaskRow, TaskPriority } from '@/types/booking-tasks';

export type BookingTaskActionKind =
  | 'collect_balance'
  | 'send_docs'
  | 'review_margin'
  | 'refund_or_settle'
  | 'reply_claim'
  | 'request_review'
  | 'seat_check'
  | 'release_deposit_gate'
  | 'review_payment'
  | 'open_booking';

export interface BookingOpsAction {
  id: string;
  bookingId: string;
  bookingNo: string | null;
  customerName: string | null;
  packageTitle: string | null;
  departureDate: string | null;
  taskType: string;
  taskTypeLabel: string;
  priority: TaskPriority;
  title: string;
  createdAt: string;
  ageMinutes: number;
  status: string;
  recommendedAction: BookingTaskActionKind;
  ctaLabel: string;
  secondaryLabel: string;
  autoResolvable: boolean;
  context: Record<string, unknown>;
  score: number;
  scoreReasons: string[];
  amountAtRisk: number;
  daysToDeparture: number | null;
  groupedTaskCount: number;
  groupedTaskIds: string[];
  relatedActions: BookingOpsRelatedAction[];
}

export interface BookingOpsRelatedAction {
  id: string;
  taskType: string;
  taskTypeLabel: string;
  title: string;
  priority: TaskPriority;
  ctaLabel: string;
  ageMinutes: number;
  score: number;
}

export interface BookingOpsPaymentBookingCandidate {
  bookingId: string;
  bookingNo: string | null;
  customerName: string | null;
  packageTitle: string | null;
  confidence: number;
  matchClass: 'auto' | 'review' | 'unmatched';
  reasons: string[];
}

export interface BookingOpsPaymentCandidate {
  transactionId: string;
  amount: number;
  counterpartyName: string | null;
  receivedAt: string | null;
  matchStatus: string | null;
  topConfidence: number;
  candidates: BookingOpsPaymentBookingCandidate[];
}

export interface BookingOpsRuleHealth {
  taskType: string;
  taskTypeLabel: string;
  open: number;
  snoozed: number;
  staleOver48h: number;
  autoResolved24h: number;
  manualResolved24h: number;
  autoResolveRatePct: number;
  tuneScore: number;
  tuneReason: string;
}

export interface BookingOpsRuleTaskInput {
  task_type: string | null;
  status: string | null;
  created_at: string | null;
  resolved_at?: string | null;
  resolution?: string | null;
}

export interface BookingOpsSummary {
  generatedAt: string;
  metrics: {
    urgentOpen: number;
    todayOpen: number;
    normalOpen: number;
    lowOpen: number;
    totalOpen: number;
    snoozed: number;
    staleOver48h: number;
    autoResolved24h: number;
    manualResolved24h: number;
    unmatchedBank: number;
    bankReview: number;
    bankErrors: number;
    bankStaleOver24h: number;
    activeBookings: number;
    totalSales: number;
    totalPaid: number;
    totalBalance: number;
    autoResolveRatePct: number;
  };
  actions: BookingOpsAction[];
  highlightedAction: BookingOpsAction | null;
  paymentMatchCandidates: BookingOpsPaymentCandidate[];
  ruleHealth: BookingOpsRuleHealth[];
}

const TASK_LABELS: Record<string, string> = {
  unpaid_balance_d7: '잔금 미수',
  excess_payment: '초과 지급',
  low_margin: '마진 경고',
  claim_keyword_reply: '클레임',
  doc_missing_d3: '확정서 미발송',
  happy_call_followup: '해피콜 후속',
  deposit_notice_gate: '계약금 안내 게이트',
  seat_check_required: '좌석 확인',
};

const TASK_ACTIONS: Record<string, {
  kind: BookingTaskActionKind;
  cta: string;
  secondary: string;
  autoResolvable: boolean;
}> = {
  unpaid_balance_d7: {
    kind: 'collect_balance',
    cta: '잔금 확인',
    secondary: '결제/알림 확인',
    autoResolvable: true,
  },
  excess_payment: {
    kind: 'refund_or_settle',
    cta: '환불/정산',
    secondary: '입출금 확인',
    autoResolvable: true,
  },
  low_margin: {
    kind: 'review_margin',
    cta: '원가 재확인',
    secondary: '견적 조정',
    autoResolvable: true,
  },
  claim_keyword_reply: {
    kind: 'reply_claim',
    cta: '응대하기',
    secondary: '타임라인 확인',
    autoResolvable: true,
  },
  doc_missing_d3: {
    kind: 'send_docs',
    cta: '확정서 발송',
    secondary: '출발 준비',
    autoResolvable: true,
  },
  happy_call_followup: {
    kind: 'request_review',
    cta: '리뷰 요청',
    secondary: '해피콜 확인',
    autoResolvable: true,
  },
  deposit_notice_gate: {
    kind: 'release_deposit_gate',
    cta: '안내 허용',
    secondary: '게이트 해제',
    autoResolvable: false,
  },
  seat_check_required: {
    kind: 'seat_check',
    cta: '좌석 확인',
    secondary: '랜드사 확인',
    autoResolvable: false,
  },
};

export function getBookingTaskTypeLabel(taskType: string): string {
  return TASK_LABELS[taskType] ?? taskType;
}

export function getBookingTaskAction(taskType: string): {
  kind: BookingTaskActionKind;
  cta: string;
  secondary: string;
  autoResolvable: boolean;
} {
  return TASK_ACTIONS[taskType] ?? {
    kind: 'open_booking',
    cta: '예약 열기',
    secondary: '상세 확인',
    autoResolvable: false,
  };
}

export function getBookingOpsPriorityRank(priority: TaskPriority): number {
  return priority;
}

function contextNumber(context: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function daysToDeparture(departureDate: string | null, context: Record<string, unknown>, now: Date): number | null {
  const contextDays = contextNumber(context, ['days_until']);
  if (contextDays !== 0 || context.days_until === 0) return contextDays;
  if (!departureDate) return null;
  const departure = new Date(departureDate);
  if (!Number.isFinite(departure.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  departure.setHours(0, 0, 0, 0);
  return Math.ceil((departure.getTime() - today.getTime()) / 86_400_000);
}

function amountAtRisk(taskType: string, context: Record<string, unknown>): number {
  if (taskType === 'unpaid_balance_d7') {
    return contextNumber(context, ['balance', 'remaining_balance', 'amount']);
  }
  if (taskType === 'excess_payment') {
    return contextNumber(context, ['excess', 'overpaid_amount', 'amount']);
  }
  if (taskType === 'low_margin') {
    return Math.abs(contextNumber(context, ['margin_krw', 'margin', 'expected_margin']));
  }
  return contextNumber(context, ['amount', 'risk_amount']);
}

export function scoreBookingOpsAction(input: {
  taskType: string;
  priority: TaskPriority;
  ageMinutes: number;
  amountAtRisk: number;
  daysToDeparture: number | null;
  autoResolvable: boolean;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = ({ 0: 110, 1: 78, 2: 45, 3: 20 } as Record<TaskPriority, number>)[input.priority];
  reasons.push(input.priority === 0 ? '긴급' : input.priority === 1 ? '오늘 처리' : '일반 큐');

  const ageHours = input.ageMinutes / 60;
  if (ageHours >= 48) {
    score += 28;
    reasons.push('48시간 초과');
  } else if (ageHours >= 24) {
    score += 16;
    reasons.push('24시간 초과');
  } else if (ageHours >= 4) {
    score += 7;
  }

  if (input.daysToDeparture !== null) {
    if (input.daysToDeparture <= 0) {
      score += 36;
      reasons.push('오늘 출발');
    } else if (input.daysToDeparture <= 3) {
      score += 30;
      reasons.push(`출발 D-${input.daysToDeparture}`);
    } else if (input.daysToDeparture <= 7) {
      score += 18;
      reasons.push(`출발 D-${input.daysToDeparture}`);
    }
  }

  if (input.amountAtRisk > 0) {
    const moneyScore = Math.min(34, Math.log10(Math.max(10_000, input.amountAtRisk)) * 6);
    score += moneyScore;
    if (input.amountAtRisk >= 1_000_000) reasons.push('금액 리스크 큼');
  }

  const typeWeight: Record<string, number> = {
    claim_keyword_reply: 32,
    unpaid_balance_d7: 24,
    excess_payment: 22,
    deposit_notice_gate: 18,
    seat_check_required: 16,
    doc_missing_d3: 13,
    low_margin: 12,
    happy_call_followup: 4,
  };
  score += typeWeight[input.taskType] ?? 0;

  if (input.autoResolvable) {
    score += 4;
    reasons.push('자동해결 가능');
  }

  return {
    score: Math.round(score * 10) / 10,
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

export function toBookingOpsAction(
  task: InboxTaskRow,
  now: Date = new Date(),
): BookingOpsAction {
  const action = getBookingTaskAction(task.task_type);
  const context = task.context ?? {};
  const created = new Date(task.created_at);
  const ageMinutes = Number.isFinite(created.getTime())
    ? Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000))
    : 0;
  const riskAmount = amountAtRisk(task.task_type, context);
  const departureDays = daysToDeparture(task.departure_date, context, now);
  const scored = scoreBookingOpsAction({
    taskType: task.task_type,
    priority: task.priority,
    ageMinutes,
    amountAtRisk: riskAmount,
    daysToDeparture: departureDays,
    autoResolvable: action.autoResolvable,
  });

  return {
    id: task.id,
    bookingId: task.booking_id,
    bookingNo: task.booking_no,
    customerName: task.customer_name,
    packageTitle: task.package_title,
    departureDate: task.departure_date,
    taskType: task.task_type,
    taskTypeLabel: getBookingTaskTypeLabel(task.task_type),
    priority: task.priority,
    title: task.title,
    createdAt: task.created_at,
    ageMinutes,
    status: task.status,
    recommendedAction: action.kind,
    ctaLabel: action.cta,
    secondaryLabel: action.secondary,
    autoResolvable: action.autoResolvable,
    context,
    score: scored.score,
    scoreReasons: scored.reasons,
    amountAtRisk: riskAmount,
    daysToDeparture: departureDays,
    groupedTaskCount: 1,
    groupedTaskIds: [task.id],
    relatedActions: [],
  };
}

export function sortBookingOpsActions(actions: BookingOpsAction[]): BookingOpsAction[] {
  return [...actions].sort((a, b) => {
    const score = b.score - a.score;
    if (score !== 0) return score;
    const priority = getBookingOpsPriorityRank(a.priority) - getBookingOpsPriorityRank(b.priority);
    if (priority !== 0) return priority;
    return b.ageMinutes - a.ageMinutes;
  });
}

export function groupBookingOpsActions(actions: BookingOpsAction[]): BookingOpsAction[] {
  const groups = new Map<string, BookingOpsAction[]>();
  for (const action of actions) {
    const key = action.bookingId || action.id;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }

  return sortBookingOpsActions([...groups.values()].map((items) => {
    const sorted = sortBookingOpsActions(items);
    const [primary, ...rest] = sorted;
    const relatedActions = rest.map((item) => ({
      id: item.id,
      taskType: item.taskType,
      taskTypeLabel: item.taskTypeLabel,
      title: item.title,
      priority: item.priority,
      ctaLabel: item.ctaLabel,
      ageMinutes: item.ageMinutes,
      score: item.score,
    }));
    const groupedBonus = Math.min(24, rest.reduce((sum, item) => sum + item.score * 0.12, 0));
    return {
      ...primary,
      score: Math.round((primary.score + groupedBonus) * 10) / 10,
      scoreReasons: rest.length > 0
        ? [...primary.scoreReasons, `관련 작업 ${rest.length}건`].slice(0, 4)
        : primary.scoreReasons,
      groupedTaskCount: sorted.length,
      groupedTaskIds: sorted.map((item) => item.id),
      relatedActions,
    };
  }));
}

export function buildBookingOpsRuleHealth(
  tasks: BookingOpsRuleTaskInput[],
  now: Date = new Date(),
): BookingOpsRuleHealth[] {
  const byType = new Map<string, BookingOpsRuleHealth>();
  const dayAgo = now.getTime() - 24 * 60 * 60_000;
  const ensure = (taskType: string): BookingOpsRuleHealth => {
    const existing = byType.get(taskType);
    if (existing) return existing;
    const next: BookingOpsRuleHealth = {
      taskType,
      taskTypeLabel: getBookingTaskTypeLabel(taskType),
      open: 0,
      snoozed: 0,
      staleOver48h: 0,
      autoResolved24h: 0,
      manualResolved24h: 0,
      autoResolveRatePct: 0,
      tuneScore: 0,
      tuneReason: '정상',
    };
    byType.set(taskType, next);
    return next;
  };

  for (const task of tasks) {
    if (!task.task_type) continue;
    const row = ensure(task.task_type);
    const status = task.status ?? 'open';
    const createdAt = task.created_at ? new Date(task.created_at).getTime() : NaN;
    const resolvedAt = task.resolved_at ? new Date(task.resolved_at).getTime() : NaN;

    if (status === 'open') row.open += 1;
    if (status === 'snoozed') row.snoozed += 1;
    if ((status === 'open' || status === 'snoozed') && Number.isFinite(createdAt)) {
      if (now.getTime() - createdAt >= 48 * 60 * 60_000) row.staleOver48h += 1;
    }
    if (status === 'auto_resolved' && Number.isFinite(resolvedAt) && resolvedAt >= dayAgo) {
      row.autoResolved24h += 1;
    }
    if (status === 'resolved' && Number.isFinite(resolvedAt) && resolvedAt >= dayAgo) {
      row.manualResolved24h += 1;
    }
  }

  return [...byType.values()]
    .map((row) => {
      const resolved = row.autoResolved24h + row.manualResolved24h;
      const autoResolveRatePct = resolved > 0
        ? Math.round((row.autoResolved24h / resolved) * 1000) / 10
        : 0;
      const staleRatio = row.open > 0 ? row.staleOver48h / row.open : 0;
      const tuneScore = Math.round((row.open * 1.5 + row.snoozed * 1.2 + row.staleOver48h * 8 + (autoResolveRatePct < 20 && row.open >= 5 ? 10 : 0)) * 10) / 10;
      const tuneReason =
        row.staleOver48h > 0 && staleRatio >= 0.25 ? '오래된 작업 과다'
          : autoResolveRatePct < 20 && row.open >= 5 ? '자동해결 낮음'
            : row.snoozed >= 5 ? '보류 반복'
              : row.open >= 10 ? '오픈 과다'
                : '정상';
      return {
        ...row,
        autoResolveRatePct,
        tuneScore,
        tuneReason,
      };
    })
    .sort((a, b) => b.tuneScore - a.tuneScore)
    .slice(0, 8);
}
