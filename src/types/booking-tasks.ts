/**
 * 여소남 OS — Booking Tasks (Inbox Zero) 타입 정의
 *
 * 관련 마이그레이션: supabase/migrations/20260427000000_booking_tasks_inbox.sql
 * 관련 러너:        src/lib/booking-tasks/runner.ts
 * 관련 룰:          src/lib/booking-tasks/rules/*.ts
 */

// ─── 룰 식별자 ────────────────────────────────────────────────────────────────
// NOTE: 미매칭 입금(unmatched_deposit)은 근본적으로 booking_id가 없어서
//       booking_tasks 모델에 안 맞음. Inbox UI에서 bank_tx_health 뷰로 별도 배너.
export const TASK_TYPES = [
  'unpaid_balance_d7',      // 잔금 미수 + 출발 D-7 이내
  'excess_payment',         // 초과지급 발생 (환불 처리 필요)
  'low_margin',             // 마진율 < 5% 신규 예약
  'claim_keyword_reply',    // 고객이 "환불/취소/화" 키워드 답장
  'doc_missing_d3',         // 확정서 미발송 + 출발 D-3 이내
  'happy_call_followup',    // 해피콜 7일 경과 + 리뷰요청 미발송
] as const;

export type TaskType = typeof TASK_TYPES[number];

// ─── 상태 머신 ────────────────────────────────────────────────────────────────
export type TaskStatus =
  | 'open'           // 처리 필요
  | 'snoozed'        // 운영자가 보류
  | 'resolved'       // 운영자가 수동 종결
  | 'auto_resolved'  // 시스템이 조건 해소 감지로 자동 종결
  | 'superseded';    // 예약 취소로 무효화

// ─── 우선순위 (DB CHECK 0..3 과 일치) ─────────────────────────────────────────
export type TaskPriority = 0 | 1 | 2 | 3;

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  0: '🔴 긴급',
  1: '🟠 오늘',
  2: '🟡 이번주',
  3: '⚪ 낮음',
};

export const PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  0: 'bg-red-100 text-red-700 ring-1 ring-red-300',
  1: 'bg-orange-100 text-orange-700',
  2: 'bg-yellow-50 text-yellow-700',
  3: 'bg-slate-100 text-slate-500',
};

// ─── DB 레코드 ────────────────────────────────────────────────────────────────
export interface BookingTask {
  id: string;
  booking_id: string;
  task_type: string;              // TaskType 이지만 DB는 TEXT 이므로 string 허용
  priority: TaskPriority;
  title: string;
  context: Record<string, unknown>;
  status: TaskStatus;
  snoozed_until: string | null;
  auto_resolve_reason: string | null;
  fingerprint: string;
  assigned_to: string | null;
  created_by: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

/** get_inbox_tasks RPC 반환 행 */
export interface InboxTaskRow {
  id: string;
  booking_id: string;
  booking_no: string | null;
  package_title: string | null;
  customer_name: string | null;
  departure_date: string | null;
  task_type: string;
  priority: TaskPriority;
  title: string;
  context: Record<string, unknown>;
  status: TaskStatus;
  created_at: string;
  snoozed_until: string | null;
}

// ─── 룰 인터페이스 (runner ↔ 각 rule 계약) ────────────────────────────────────

/** 룰이 감지한 신규 Task 시드 (fingerprint/priority는 룰이 제공, runner가 INSERT) */
export interface DetectedTask {
  bookingId: string;
  title: string;
  context: Record<string, unknown>;
  /** 룰 기본값과 다른 우선순위를 주고 싶을 때만 (예: D-1 urgent 승급) */
  priorityOverride?: TaskPriority;
  /** 날짜 bucket 등 fingerprint 차별화가 필요할 때 (기본: YYYYMMDD) */
  fingerprintSalt?: string;
}

/** evaluateStale 결과 — 자동 종결할 open Task id 목록 */
export interface AutoResolveDecision {
  taskId: string;
  reason: string;                 // 'balance_paid' 등
}

export interface TaskRule {
  /** 유니크 ID. task_type 과 동일 문자열 권장 */
  id: string;

  /** DB에 저장될 task_type */
  taskType: string;

  /** 기본 우선순위 (detect 가 priorityOverride 로 덮을 수 있음) */
  priority: TaskPriority;

  /** 한 번 resolved/auto_resolved 된 뒤 N일 간 재감지 차단 (runner가 확인) */
  cooldownDays: number;

  /** 신규 Task 감지 */
  detect(ctx: RuleContext): Promise<DetectedTask[]>;

  /** 기존 open Task 들이 아직 유효한지 검사 — 유효하지 않으면 auto_resolve */
  evaluateStale(openTasks: BookingTask[], ctx: RuleContext): Promise<AutoResolveDecision[]>;
}

export interface RuleContext {
  /** 크론 실행 기준 시각 (테스트 시 고정값 주입 가능) */
  now: Date;
  /** 강제 실행 여부 (테스트용) */
  isForce: boolean;
  /** 크론 실행 ID (로그 상관관계용) */
  runId: string;
}

// ─── 러너 실행 결과 ──────────────────────────────────────────────────────────
export interface RuleRunResult {
  ruleId: string;
  detected: number;              // detect 가 반환한 seed 개수
  inserted: number;              // 실제 INSERT (cooldown / fingerprint 통과)
  cooldownSkipped: number;       // cooldown 으로 skip 된 seed
  duplicateSkipped: number;      // 활성/fingerprint 유니크 위반으로 skip
  autoResolved: number;          // evaluateStale 로 닫힌 수
  durationMs: number;
  errors: string[];
}

export interface RunnerResult {
  wokenFromSnooze: number;
  rules: RuleRunResult[];
  totalDurationMs: number;
  runId: string;
}

// ─── Snooze 프리셋 (UI 버튼) ─────────────────────────────────────────────────
export const SNOOZE_PRESETS: Array<{ label: string; hours: number }> = [
  { label: '3시간 후',   hours: 3 },
  { label: '내일 오전',  hours: 24 },
  { label: '3일 뒤',     hours: 72 },
  { label: '1주일 뒤',   hours: 168 },
];

export function snoozePresetIso(hours: number, base: Date = new Date()): string {
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}
