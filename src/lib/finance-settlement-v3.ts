export const FINANCE_ALLOCATION_TARGETS = [
  'booking',
  'customer_refund',
  'bank_fee',
  'company_expense',
  'company_travel',
  'tax',
  'capital',
  'transfer',
  'owner_draw',
  'other_income',
  'unassigned',
] as const;

export type FinanceAllocationTarget = typeof FINANCE_ALLOCATION_TARGETS[number];

export const BOOKING_SETTLEMENT_DECISIONS = [
  'confirmed',
  'customer_cancelled',
  'invalid_booking',
  'reclassified',
  'deferred',
] as const;

export type BookingSettlementDecision = typeof BOOKING_SETTLEMENT_DECISIONS[number];
export type BookingSettlementReviewStatus = 'pending' | BookingSettlementDecision | 'superseded';

export const FINANCE_TARGET_LABELS: Record<FinanceAllocationTarget, string> = {
  booking: '여행 예약',
  customer_refund: '고객 취소환불',
  bank_fee: '은행 송금수수료',
  company_expense: '회사 일반경비',
  company_travel: '회사 출장경비',
  tax: '세금',
  capital: '자본금·차입금',
  transfer: '계좌이체',
  owner_draw: '대표자 개인사용',
  other_income: '기타 영업수입',
  unassigned: '미분류',
};

export const BOOKING_REVIEW_LABELS: Record<BookingSettlementReviewStatus, string> = {
  pending: '재검토 필요',
  confirmed: '건별 확인 완료',
  customer_cancelled: '고객 취소·환불',
  invalid_booking: '오예약·중복 제외',
  reclassified: '예약 아님',
  deferred: '보류',
  superseded: '이전 검토',
};

export interface FinanceV3Transaction {
  id: string;
  transaction_type: string;
  amount: number;
}

export interface FinanceV3Allocation {
  bank_transaction_id: string;
  booking_id?: string | null;
  allocated_amount: number;
  target_type?: FinanceAllocationTarget | null;
}

export interface BookingCashBreakdown {
  deposits: number;
  travelWithdrawals: number;
  customerRefunds: number;
  bankFees: number;
  cashMargin: number;
  transactionCount: number;
}

function money(value: unknown): number {
  return Math.round(Number(value) || 0);
}

export function summarizeBookingCashBreakdown(params: {
  bookingId: string;
  transactions: FinanceV3Transaction[];
  allocations: FinanceV3Allocation[];
}): BookingCashBreakdown {
  const transactionById = new Map(params.transactions.map(transaction => [transaction.id, transaction]));
  const transactionIds = new Set<string>();
  let deposits = 0;
  let travelWithdrawals = 0;
  let customerRefunds = 0;
  let bankFees = 0;

  for (const allocation of params.allocations) {
    if (allocation.booking_id !== params.bookingId) continue;
    const transaction = transactionById.get(allocation.bank_transaction_id);
    if (!transaction) continue;
    const amount = money(allocation.allocated_amount);
    if (amount <= 0) continue;
    const target = allocation.target_type ?? 'booking';
    transactionIds.add(transaction.id);

    if (target === 'customer_refund') customerRefunds += amount;
    else if (target === 'bank_fee') bankFees += amount;
    else if (target === 'booking' && transaction.transaction_type === '입금') deposits += amount;
    else if (target === 'booking' && transaction.transaction_type === '출금') travelWithdrawals += amount;
  }

  return {
    deposits,
    travelWithdrawals,
    customerRefunds,
    bankFees,
    cashMargin: deposits - travelWithdrawals - customerRefunds,
    transactionCount: transactionIds.size,
  };
}

export function validateBreakdownTotal(
  sourceAmount: number,
  lines: Array<{ amount: number }>,
): { allocated: number; remaining: number; exact: boolean } {
  const source = money(sourceAmount);
  const allocated = lines.reduce((sum, line) => sum + money(line.amount), 0);
  return { allocated, remaining: source - allocated, exact: source === allocated };
}

export function canCloseSettlementMonth(statuses: BookingSettlementReviewStatus[]): {
  normal: boolean;
  conditional: boolean;
  pendingCount: number;
  deferredCount: number;
} {
  const pendingCount = statuses.filter(status => status === 'pending').length;
  const deferredCount = statuses.filter(status => status === 'deferred').length;
  return {
    normal: pendingCount === 0 && deferredCount === 0,
    conditional: pendingCount === 0 && deferredCount > 0,
    pendingCount,
    deferredCount,
  };
}
