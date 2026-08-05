export interface MonthlyCloseTransaction {
  id: string;
  transaction_type: '입금' | '출금' | string;
  amount: number;
}

export interface MonthlyCloseAllocation {
  bank_transaction_id: string;
  booking_id: string;
  allocated_amount: number;
}

export interface MonthlyCloseBooking {
  id: string;
  booking_no?: string | null;
  package_title?: string | null;
  departure_date?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
  settlement_confirmed_at?: string | null;
  settlement_mode?: string | null;
}

export type MonthlyCloseReviewReason =
  | 'no_bank_evidence'
  | 'allocation_drift'
  | 'zero_cash_margin'
  | 'negative_cash_margin';

export interface MonthlyCloseItem {
  bookingId: string;
  bookingNo: string;
  packageTitle: string | null;
  departureDate: string;
  deposits: number;
  withdrawals: number;
  cashNet: number;
  allocationCount: number;
  reason?: MonthlyCloseReviewReason;
}

export interface MonthlySettlementClosePreview {
  month: string;
  throughDate: string;
  candidateFingerprint: string;
  eligible: MonthlyCloseItem[];
  review: MonthlyCloseItem[];
  summary: {
    eligibleCount: number;
    eligibleProfit: number;
    eligibleDeposits: number;
    eligibleWithdrawals: number;
    alreadyConfirmedCount: number;
    alreadyConfirmedProfit: number;
    reviewCount: number;
    noBankEvidenceCount: number;
    allocationDriftCount: number;
    zeroCashMarginCount: number;
    negativeCashMarginCount: number;
    negativeCashMargin: number;
    cancelledOrDeletedCount: number;
  };
}

function money(value: number | null | undefined): number {
  return Math.round(Number(value) || 0);
}

export function settlementMonthBounds(month: string): { startDate: string; endDate: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error('month는 YYYY-MM 형식이어야 합니다.');

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2000 || year > 2100) throw new Error('지원하지 않는 정산 연도입니다.');

  const startDate = `${match[1]}-${match[2]}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function previousCompletedKoreaMonth(referenceDate: Date | string = new Date()): string {
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const koreaNow = new Date(date.getTime() + 9 * 60 * 60_000);
  return new Date(Date.UTC(koreaNow.getUTCFullYear(), koreaNow.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

export function assertCompletedSettlementMonth(
  month: string,
  referenceDate: Date | string = new Date(),
): void {
  settlementMonthBounds(month);
  if (month > previousCompletedKoreaMonth(referenceDate)) {
    throw new Error('아직 끝나지 않은 출발 월은 마감할 수 없습니다.');
  }
}

export function calculateMonthlySettlementClosePreview(params: {
  month: string;
  transactions: MonthlyCloseTransaction[];
  allocations: MonthlyCloseAllocation[];
  bookings: MonthlyCloseBooking[];
}): MonthlySettlementClosePreview {
  const { endDate } = settlementMonthBounds(params.month);
  const transactionById = new Map(params.transactions.map(row => [row.id, row]));
  const allocatedByTransaction = new Map<string, number>();
  const allocationsByBooking = new Map<string, MonthlyCloseAllocation[]>();

  for (const allocation of params.allocations) {
    const amount = money(allocation.allocated_amount);
    if (amount <= 0 || !transactionById.has(allocation.bank_transaction_id)) continue;
    allocatedByTransaction.set(
      allocation.bank_transaction_id,
      (allocatedByTransaction.get(allocation.bank_transaction_id) ?? 0) + amount,
    );
    const bookingAllocations = allocationsByBooking.get(allocation.booking_id) ?? [];
    bookingAllocations.push({ ...allocation, allocated_amount: amount });
    allocationsByBooking.set(allocation.booking_id, bookingAllocations);
  }

  const eligible: MonthlyCloseItem[] = [];
  const review: MonthlyCloseItem[] = [];
  let alreadyConfirmedCount = 0;
  let alreadyConfirmedProfit = 0;
  let cancelledOrDeletedCount = 0;

  const relevantBookings = params.bookings
    .filter(booking => booking.departure_date && booking.departure_date.slice(0, 10) <= endDate)
    .sort((a, b) => {
      const dateDiff = String(a.departure_date).localeCompare(String(b.departure_date));
      return dateDiff || String(a.booking_no ?? a.id).localeCompare(String(b.booking_no ?? b.id));
    });

  for (const booking of relevantBookings) {
    if (booking.is_deleted || booking.status === 'cancelled') {
      cancelledOrDeletedCount += 1;
      continue;
    }

    const bookingAllocations = allocationsByBooking.get(booking.id) ?? [];
    let deposits = 0;
    let withdrawals = 0;
    let hasAllocationDrift = false;

    for (const allocation of bookingAllocations) {
      const transaction = transactionById.get(allocation.bank_transaction_id);
      if (!transaction) continue;
      if (allocatedByTransaction.get(transaction.id) !== money(transaction.amount)) {
        hasAllocationDrift = true;
      }
      if (transaction.transaction_type === '입금') deposits += allocation.allocated_amount;
      else if (transaction.transaction_type === '출금') withdrawals += allocation.allocated_amount;
    }

    const item: MonthlyCloseItem = {
      bookingId: booking.id,
      bookingNo: booking.booking_no || booking.id,
      packageTitle: booking.package_title ?? null,
      departureDate: String(booking.departure_date).slice(0, 10),
      deposits,
      withdrawals,
      cashNet: deposits - withdrawals,
      allocationCount: bookingAllocations.length,
    };

    if (booking.settlement_confirmed_at) {
      alreadyConfirmedCount += 1;
      alreadyConfirmedProfit += item.cashNet;
      continue;
    }

    if (bookingAllocations.length === 0) {
      review.push({ ...item, reason: 'no_bank_evidence' });
    } else if (hasAllocationDrift) {
      review.push({ ...item, reason: 'allocation_drift' });
    } else if (item.cashNet < 0) {
      review.push({ ...item, reason: 'negative_cash_margin' });
    } else if (item.cashNet === 0) {
      review.push({ ...item, reason: 'zero_cash_margin' });
    } else {
      eligible.push(item);
    }
  }

  return {
    month: params.month,
    throughDate: endDate,
    candidateFingerprint: eligible
      .map(row => `${row.bookingId}:${row.deposits}:${row.withdrawals}`)
      .sort()
      .join('|'),
    eligible,
    review,
    summary: {
      eligibleCount: eligible.length,
      eligibleProfit: eligible.reduce((sum, row) => sum + row.cashNet, 0),
      eligibleDeposits: eligible.reduce((sum, row) => sum + row.deposits, 0),
      eligibleWithdrawals: eligible.reduce((sum, row) => sum + row.withdrawals, 0),
      alreadyConfirmedCount,
      alreadyConfirmedProfit,
      reviewCount: review.length,
      noBankEvidenceCount: review.filter(row => row.reason === 'no_bank_evidence').length,
      allocationDriftCount: review.filter(row => row.reason === 'allocation_drift').length,
      zeroCashMarginCount: review.filter(row => row.reason === 'zero_cash_margin').length,
      negativeCashMarginCount: review.filter(row => row.reason === 'negative_cash_margin').length,
      negativeCashMargin: review
        .filter(row => row.reason === 'negative_cash_margin')
        .reduce((sum, row) => sum + row.cashNet, 0),
      cancelledOrDeletedCount,
    },
  };
}
