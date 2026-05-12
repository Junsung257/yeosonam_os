/**
 * 예약·RFQ·정산 상태 배지 색상 SSOT
 * 어드민 전체에서 이 파일을 import — 인라인 재정의 금지 (code-review Phase B §7)
 */

/** 예약(bookings) 상태 배지 — Tailwind 클래스 */
export const BOOKING_STATUS_COLOR: Record<string, string> = {
  pending:          'bg-yellow-50 text-yellow-700',
  waiting_deposit:  'bg-amber-50 text-amber-700',
  deposit_paid:     'bg-blue-50 text-blue-700',
  waiting_balance:  'bg-sky-50 text-sky-700',
  fully_paid:       'bg-emerald-50 text-emerald-700',
  confirmed:        'bg-blue-50 text-blue-700',
  completed:        'bg-green-50 text-green-700',
  cancelled:        'bg-slate-100 text-slate-500',
  refunded:         'bg-slate-100 text-slate-400',
};

/** 예약 상태 한글 레이블 */
export const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending:          '입금대기',
  waiting_deposit:  '입금대기',
  deposit_paid:     '계약금납부',
  waiting_balance:  '잔금대기',
  fully_paid:       '완납',
  confirmed:        '예약확정',
  completed:        '여행완료',
  cancelled:        '취소',
  refunded:         '환불완료',
};

/** RFQ 상태 배지 */
export const RFQ_STATUS_COLOR: Record<string, string> = {
  draft:              'bg-slate-100 text-slate-600',
  published:          'bg-blue-50 text-blue-700',
  bidding:            'bg-amber-50 text-amber-700',
  analyzing:          'bg-purple-50 text-purple-700',
  awaiting_selection: 'bg-orange-50 text-orange-700',
  contracted:         'bg-green-50 text-green-700',
  cancelled:          'bg-slate-100 text-slate-500',
};

/** 정산 상태 배지 (제휴 settlements) */
export const SETTLEMENT_STATUS_COLOR: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border border-amber-200',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

/** 랜드사 정산 묶음 배지 (land_settlements) */
export const LAND_SETTLEMENT_STATUS_COLOR: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reversed:  'bg-slate-100 text-slate-500 border-slate-200',
};

/** 패키지 승인 상태 배지 */
export const PACKAGE_STATUS_COLOR: Record<string, string> = {
  active:          'bg-green-50 text-green-700',
  approved:        'bg-blue-50 text-blue-700',
  pending_review:  'bg-amber-50 text-amber-700',
  draft:           'bg-slate-100 text-slate-600',
  archived:        'bg-slate-100 text-slate-400',
  rejected:        'bg-red-50 text-red-600',
};
