/**
 * 예약 여정 상태 머신
 * PENDING → WAITING_DEPOSIT → DEPOSIT_PAID → WAITING_BALANCE → FULLY_PAID
 * 어느 단계에서든 → CANCELLED 가능
 */

export type BookingStatus =
  | 'pending'
  | 'waiting_deposit'
  | 'deposit_paid'
  | 'waiting_balance'
  | 'fully_paid'
  | 'cancelled'
  | 'confirmed'   // 레거시 (≈ deposit_paid)
  | 'completed';  // 레거시 (≈ fully_paid)

export type MessageEventType =
  | 'DEPOSIT_NOTICE'
  | 'DEPOSIT_CONFIRMED'
  | 'BALANCE_NOTICE'
  | 'BALANCE_CONFIRMED'
  | 'CONFIRMATION_GUIDE'
  | 'HAPPY_CALL'
  | 'CANCELLATION'
  | 'MANUAL_MEMO';

export interface TransitionDef {
  to: BookingStatus;
  label: string;         // 버튼 텍스트
  isMock?: boolean;      // 🧪 Mock 배지 표시
  eventType: MessageEventType;
  logTitle: string;      // message_logs.title
  logContent?: string;   // message_logs.content
}

export interface StepDef {
  status: BookingStatus;
  label: string;
  step: number;          // 0-4 (progress bar)
}

/** 여정 5단계 (취소 제외) */
export const JOURNEY_STEPS: StepDef[] = [
  { status: 'pending',          label: '예약접수',    step: 0 },
  { status: 'waiting_deposit',  label: '계약금 대기', step: 1 },
  { status: 'deposit_paid',     label: '계약금 완납', step: 2 },
  { status: 'waiting_balance',  label: '잔금 대기',   step: 3 },
  { status: 'fully_paid',       label: '완납',        step: 4 },
];

/** 레거시 상태 → 단계 매핑 */
const LEGACY_STEP: Partial<Record<BookingStatus, number>> = {
  confirmed: 2,
  completed: 4,
};

/** 허용된 상태 전이 맵 */
export const ALLOWED_TRANSITIONS: Record<string, TransitionDef[]> = {
  pending: [
    {
      to: 'waiting_deposit',
      label: '랜드사 승인 (계약금 청구)',
      eventType: 'DEPOSIT_NOTICE',
      logTitle: '계약금 안내 발송',
      logContent: '랜드사 승인 완료. 고객에게 계약금 납부 안내가 발송됩니다.',
    },
  ],
  waiting_deposit: [
    {
      to: 'deposit_paid',
      label: '테스트: 계약금 입금 확인',
      isMock: true,
      eventType: 'DEPOSIT_CONFIRMED',
      logTitle: '계약금 입금 확인 (Mock)',
      logContent: '계약금 입금이 확인되었습니다. (테스트 시뮬레이션)',
    },
  ],
  deposit_paid: [
    {
      to: 'waiting_balance',
      label: '잔금 안내 발송',
      eventType: 'BALANCE_NOTICE',
      logTitle: '잔금 안내 발송',
      logContent: '출발 전 잔금 납부를 안내합니다.',
    },
  ],
  waiting_balance: [
    {
      to: 'fully_paid',
      label: '테스트: 잔금 입금 확인',
      isMock: true,
      eventType: 'BALANCE_CONFIRMED',
      logTitle: '잔금 입금 확인 (Mock)',
      logContent: '잔금 입금이 확인되었습니다. 예약이 완납 처리됩니다. (테스트 시뮬레이션)',
    },
  ],
  fully_paid: [],
  cancelled: [],
  // 레거시: 기존 confirmed/completed 상태에서도 전이 허용
  confirmed: [
    {
      to: 'waiting_balance',
      label: '잔금 안내 발송',
      eventType: 'BALANCE_NOTICE',
      logTitle: '잔금 안내 발송',
    },
  ],
  completed: [],
};

/** 전이 가능 여부 확인 */
export function isValidTransition(from: string, to: string): boolean {
  const transitions = ALLOWED_TRANSITIONS[from] ?? [];
  return transitions.some(t => t.to === to);
}

/** 상태 → Progress Bar 단계 인덱스 (0~4, -1=취소) */
export function getStepIndex(status: string): number {
  if (status === 'cancelled') return -1;
  const legacy = LEGACY_STEP[status as BookingStatus];
  if (legacy !== undefined) return legacy;
  const step = JOURNEY_STEPS.find(s => s.status === status);
  return step?.step ?? 0;
}

/** 상태 한글 라벨 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending:          '예약접수',
    waiting_deposit:  '계약금 대기',
    deposit_paid:     '계약금 완납',
    waiting_balance:  '잔금 대기',
    fully_paid:       '완납',
    cancelled:        '취소',
    confirmed:        '예약확정',
    completed:        '결제완료',
  };
  return labels[status] ?? status;
}

/** 상태 배지 색상 클래스 */
export function getStatusBadgeClass(status: string): string {
  const classes: Record<string, string> = {
    pending:          'bg-gray-100 text-gray-600',
    waiting_deposit:  'bg-yellow-100 text-yellow-700',
    deposit_paid:     'bg-blue-100 text-blue-700',
    waiting_balance:  'bg-orange-100 text-orange-700',
    fully_paid:       'bg-green-100 text-green-700',
    cancelled:        'bg-red-100 text-red-600',
    confirmed:        'bg-blue-100 text-blue-700',
    completed:        'bg-green-100 text-green-700',
  };
  return classes[status] ?? 'bg-gray-100 text-gray-600';
}
