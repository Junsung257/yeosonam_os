export type BankSettlementScope = 'travel' | 'non_travel';

export const YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER = '100038454128';

export interface BankAccountRealityRow {
  id?: string;
  transaction_type: '입금' | '출금' | string;
  amount: number;
  received_at: string;
  settlement_scope?: BankSettlementScope | null;
  account_number?: string | null;
  balance_after?: number | null;
  memo?: string | null;
  provider_is_unclassified?: boolean | null;
}

export interface BankAccountRealitySummary {
  accountNumber: string | null;
  asOf: string | null;
  transactionCount: number;
  openingBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  computedBalance: number;
  actualBalance: number;
  balanceSource: 'provider_after_balance' | 'computed';
  reconciliationDifference: number;
  travelCount: number;
  travelDeposits: number;
  travelWithdrawals: number;
  travelNet: number;
  nonTravelCount: number;
  nonTravelDeposits: number;
  nonTravelWithdrawals: number;
  nonTravelNet: number;
  memoReviewCount: number;
  bookingCash?: BookingCashPositionSummary;
}

export interface BookingCashAllocationRow {
  bank_transaction_id: string;
  booking_id: string;
  allocated_amount: number;
}

export interface BookingCashBookingRow {
  id: string;
  departure_date?: string | null;
  settlement_confirmed_at?: string | null;
  total_price?: number | null;
  total_cost?: number | null;
}

export interface BookingCashBucket {
  bookingCount: number;
  deposits: number;
  withdrawals: number;
  cashNet: number;
  customerFundsHeld: number;
  companyAdvanceOutstanding: number;
  companyPrefundingRequired: number;
  priceMissingCount: number;
  costMissingCount: number;
  knownCustomerReceivable: number;
  knownSupplierPayable: number;
}

export interface BookingCashPositionSummary {
  referenceDate: string;
  settled: BookingCashBucket;
  preDeparture: BookingCashBucket;
  departedUnsettled: BookingCashBucket;
  dateMissing: BookingCashBucket;
  openCustomerFundsHeld: number;
  openCompanyAdvanceOutstanding: number;
  openCompanyPrefundingRequired: number;
  unallocatedTravelCount: number;
  overallocatedTravelCount: number;
  unallocatedTravelNet: number;
  travelCashNet: number;
  reconciliationDifference: number;
}

function money(value: number | null | undefined): number {
  return Math.round(Number(value) || 0);
}

function isDeposit(row: BankAccountRealityRow): boolean {
  return row.transaction_type === '입금';
}

function emptyBookingCashBucket(): BookingCashBucket {
  return {
    bookingCount: 0,
    deposits: 0,
    withdrawals: 0,
    cashNet: 0,
    customerFundsHeld: 0,
    companyAdvanceOutstanding: 0,
    companyPrefundingRequired: 0,
    priceMissingCount: 0,
    costMissingCount: 0,
    knownCustomerReceivable: 0,
    knownSupplierPayable: 0,
  };
}

function koreaDate(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

/**
 * Separates travel cash from earned margin. A positive open-booking balance is
 * customer money still held for the trip; a negative balance is company cash
 * currently advanced. Profit is recognized only after settlement confirmation.
 */
export function calculateBookingCashPositions(params: {
  transactions: BankAccountRealityRow[];
  allocations: BookingCashAllocationRow[];
  bookings: BookingCashBookingRow[];
  referenceDate?: Date | string;
}): BookingCashPositionSummary {
  const referenceDate = koreaDate(params.referenceDate ?? new Date());
  const transactions = params.transactions.filter(row =>
    row.id
    && row.settlement_scope === 'travel'
    && Number.isFinite(Number(row.amount))
    && Number(row.amount) > 0
    && (row.transaction_type === '입금' || row.transaction_type === '출금'),
  );
  const transactionById = new Map(transactions.map(row => [row.id as string, row]));
  const bookingById = new Map(params.bookings.map(row => [row.id, row]));
  const allocatedByTransaction = new Map<string, number>();
  const eventsByBooking = new Map<string, Array<{
    transactionId: string;
    receivedAt: string;
    deposit: number;
    withdrawal: number;
    signedAmount: number;
  }>>();

  for (const allocation of params.allocations) {
    const transaction = transactionById.get(allocation.bank_transaction_id);
    const amount = money(allocation.allocated_amount);
    if (!transaction || amount <= 0) continue;

    allocatedByTransaction.set(
      allocation.bank_transaction_id,
      (allocatedByTransaction.get(allocation.bank_transaction_id) ?? 0) + amount,
    );
    const deposit = isDeposit(transaction) ? amount : 0;
    const withdrawal = isDeposit(transaction) ? 0 : amount;
    const event = {
      transactionId: allocation.bank_transaction_id,
      receivedAt: transaction.received_at,
      deposit,
      withdrawal,
      signedAmount: deposit - withdrawal,
    };
    const bookingEvents = eventsByBooking.get(allocation.booking_id) ?? [];
    bookingEvents.push(event);
    eventsByBooking.set(allocation.booking_id, bookingEvents);
  }

  const buckets = {
    settled: emptyBookingCashBucket(),
    preDeparture: emptyBookingCashBucket(),
    departedUnsettled: emptyBookingCashBucket(),
    dateMissing: emptyBookingCashBucket(),
  };

  for (const [bookingId, events] of eventsByBooking) {
    const booking = bookingById.get(bookingId);
    const sortedEvents = events.slice().sort((a, b) => {
      const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      return timeDiff || a.transactionId.localeCompare(b.transactionId);
    });
    let runningNet = 0;
    let minimumRunningNet = 0;
    let deposits = 0;
    let withdrawals = 0;
    for (const event of sortedEvents) {
      deposits += event.deposit;
      withdrawals += event.withdrawal;
      runningNet += event.signedAmount;
      minimumRunningNet = Math.min(minimumRunningNet, runningNet);
    }

    const bucket = booking?.settlement_confirmed_at
      ? buckets.settled
      : !booking?.departure_date
        ? buckets.dateMissing
        : booking.departure_date >= referenceDate
          ? buckets.preDeparture
          : buckets.departedUnsettled;
    bucket.bookingCount += 1;
    bucket.deposits += deposits;
    bucket.withdrawals += withdrawals;
    bucket.cashNet += runningNet;
    bucket.customerFundsHeld += Math.max(0, runningNet);
    bucket.companyAdvanceOutstanding += Math.max(0, -runningNet);
    bucket.companyPrefundingRequired += Math.max(0, -minimumRunningNet);
    const totalPrice = money(booking?.total_price);
    const totalCost = money(booking?.total_cost);
    if (totalPrice > 0) bucket.knownCustomerReceivable += Math.max(0, totalPrice - deposits);
    else bucket.priceMissingCount += 1;
    if (totalCost > 0) bucket.knownSupplierPayable += Math.max(0, totalCost - withdrawals);
    else bucket.costMissingCount += 1;
  }

  let travelCashNet = 0;
  let unallocatedTravelNet = 0;
  let unallocatedTravelCount = 0;
  let overallocatedTravelCount = 0;
  for (const transaction of transactions) {
    const amount = money(transaction.amount);
    const direction = isDeposit(transaction) ? 1 : -1;
    travelCashNet += direction * amount;
    const remainder = amount - (allocatedByTransaction.get(transaction.id as string) ?? 0);
    if (remainder !== 0) {
      unallocatedTravelCount += 1;
      if (remainder < 0) overallocatedTravelCount += 1;
      unallocatedTravelNet += direction * remainder;
    }
  }

  const allocatedCashNet = Object.values(buckets)
    .reduce((sum, bucket) => sum + bucket.cashNet, 0);
  const openBuckets = [buckets.preDeparture, buckets.departedUnsettled, buckets.dateMissing];

  return {
    referenceDate,
    ...buckets,
    openCustomerFundsHeld: openBuckets.reduce((sum, bucket) => sum + bucket.customerFundsHeld, 0),
    openCompanyAdvanceOutstanding: openBuckets.reduce((sum, bucket) => sum + bucket.companyAdvanceOutstanding, 0),
    openCompanyPrefundingRequired: openBuckets.reduce((sum, bucket) => sum + bucket.companyPrefundingRequired, 0),
    unallocatedTravelCount,
    overallocatedTravelCount,
    unallocatedTravelNet,
    travelCashNet,
    reconciliationDifference: travelCashNet - allocatedCashNet - unallocatedTravelNet,
  };
}

export function needsNonTravelMemoReview(row: BankAccountRealityRow): boolean {
  if (row.settlement_scope !== 'non_travel') return false;
  const memo = (row.memo ?? '').normalize('NFKC').trim();
  if (!memo || row.provider_is_unclassified === true) return true;
  return /(?:^|\D)\d{6}(?:\D|$)|취소|환불/.test(memo);
}

export function calculateBankAccountReality(
  inputRows: BankAccountRealityRow[],
): BankAccountRealitySummary {
  const rows = inputRows
    .filter(row => Number.isFinite(Number(row.amount)) && Number(row.amount) > 0)
    .slice()
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

  const earliestWithBalance = rows.find(row => row.balance_after != null);
  const latestWithBalance = rows.slice().reverse().find(row => row.balance_after != null);
  const openingBalance = earliestWithBalance
    ? money(earliestWithBalance.balance_after)
      - (isDeposit(earliestWithBalance) ? money(earliestWithBalance.amount) : 0)
      + (isDeposit(earliestWithBalance) ? 0 : money(earliestWithBalance.amount))
    : 0;

  const totals = rows.reduce((result, row) => {
    const amount = money(row.amount);
    const deposit = isDeposit(row) ? amount : 0;
    const withdrawal = isDeposit(row) ? 0 : amount;
    result.totalDeposits += deposit;
    result.totalWithdrawals += withdrawal;

    if (row.settlement_scope === 'non_travel') {
      result.nonTravelCount += 1;
      result.nonTravelDeposits += deposit;
      result.nonTravelWithdrawals += withdrawal;
      if (needsNonTravelMemoReview(row)) result.memoReviewCount += 1;
    } else {
      result.travelCount += 1;
      result.travelDeposits += deposit;
      result.travelWithdrawals += withdrawal;
    }
    return result;
  }, {
    totalDeposits: 0,
    totalWithdrawals: 0,
    travelCount: 0,
    travelDeposits: 0,
    travelWithdrawals: 0,
    nonTravelCount: 0,
    nonTravelDeposits: 0,
    nonTravelWithdrawals: 0,
    memoReviewCount: 0,
  });

  const computedBalance = openingBalance + totals.totalDeposits - totals.totalWithdrawals;
  const actualBalance = latestWithBalance ? money(latestWithBalance.balance_after) : computedBalance;

  return {
    accountNumber: latestWithBalance?.account_number ?? rows.at(-1)?.account_number ?? null,
    asOf: latestWithBalance?.received_at ?? rows.at(-1)?.received_at ?? null,
    transactionCount: rows.length,
    openingBalance,
    ...totals,
    computedBalance,
    actualBalance,
    balanceSource: latestWithBalance ? 'provider_after_balance' : 'computed',
    reconciliationDifference: actualBalance - computedBalance,
    travelNet: totals.travelDeposits - totals.travelWithdrawals,
    nonTravelNet: totals.nonTravelDeposits - totals.nonTravelWithdrawals,
  };
}
