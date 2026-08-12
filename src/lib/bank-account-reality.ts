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
  counterparty_name?: string | null;
  provider_category?: string | null;
  provider_is_unclassified?: boolean | null;
  match_status?: string | null;
  resolved_classification?:
    | 'company_expense'
    | 'company_travel'
    | 'tax'
    | 'capital'
    | 'transfer'
    | 'refund'
    | 'owner_draw'
    | 'other_income'
    | 'review'
    | null;
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
  profitErp?: BankProfitErpSummary;
}

export interface BookingCashAllocationRow {
  bank_transaction_id: string;
  booking_id: string | null;
  allocated_amount: number;
  target_type?:
    | 'booking'
    | 'customer_refund'
    | 'bank_fee'
    | 'company_expense'
    | 'company_travel'
    | 'tax'
    | 'capital'
    | 'transfer'
    | 'owner_draw'
    | 'other_income'
    | 'unassigned'
    | 'review'
    | null;
}

export interface BookingCashBookingRow {
  id: string;
  departure_date?: string | null;
  settlement_confirmed_at?: string | null;
  total_price?: number | null;
  total_cost?: number | null;
  status?: string | null;
  is_deleted?: boolean | null;
  finance_excluded?: boolean | null;
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
  cashReserveRequired: number;
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
  openKnownSupplierPayable: number;
  openCashReserveRequired: number;
  unallocatedTravelCount: number;
  overallocatedTravelCount: number;
  unallocatedTravelNet: number;
  classifiedNonBookingNet: number;
  travelCashNet: number;
  reconciliationDifference: number;
}

export interface SettlementProfitSnapshot {
  booking_id: string;
  departure_date: string;
  cash_margin: number;
}

export type NonTravelProfitClass =
  | 'operating_income'
  | 'operating_expense'
  | 'tax_payment'
  | 'financing'
  | 'pass_through'
  | 'review';

export interface MonthlyProfitPoint {
  month: string;
  confirmedTravelProfit: number;
  estimatedTaxReserve: number;
  afterTaxTravelProfit: number;
  classifiedOperatingIncome: number;
  classifiedOperatingExpense: number;
  provisionalOperatingCashResult: number;
}

export interface BankProfitErpSummary {
  taxRate: number;
  confirmedTravelProfit: number;
  confirmedBookingCount: number;
  estimatedTaxLiability: number;
  estimatedTaxReserve: number;
  afterTaxTravelProfit: number;
  classifiedOperatingIncome: number;
  classifiedOperatingExpense: number;
  actualTaxPayments: number;
  provisionalOperatingCashResult: number;
  provisionalAfterTaxOperatingCashResult: number;
  protectedCustomerFunds: number;
  unpaidSupplierCost: number;
  protectedTravelCash: number;
  protectedUnallocatedTravelCash: number;
  protectedUnclassifiedInflows: number;
  liquidityAvailableAfterReserves: number;
  earnedProfitAvailable: number;
  safeToWithdraw: number;
  liquidityShortfall: number;
  classificationReviewCount: number;
  classificationReviewGross: number;
  classificationReviewNet: number;
  classificationCoveragePercent: number;
  financingCount: number;
  financingNet: number;
  passThroughCount: number;
  passThroughNet: number;
  calculationStatus: 'clear' | 'blocked';
  blockers: string[];
  monthly: MonthlyProfitPoint[];
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
    cashReserveRequired: 0,
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
  confirmedBookingIds?: Iterable<string>;
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
  const confirmedBookingIds = params.confirmedBookingIds ? new Set(params.confirmedBookingIds) : null;
  const allocatedByTransaction = new Map<string, number>();
  let classifiedNonBookingNet = 0;
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
    const targetType = allocation.target_type ?? 'booking';
    const booking = allocation.booking_id ? bookingById.get(allocation.booking_id) : null;
    const isBookingCash = targetType === 'booking' || targetType === 'customer_refund';
    if (!isBookingCash || !allocation.booking_id || !booking) {
      classifiedNonBookingNet += isDeposit(transaction) ? amount : -amount;
      continue;
    }
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

  for (const booking of params.bookings) {
    const bookingId = booking.id;
    const events = eventsByBooking.get(bookingId) ?? [];
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

    if (booking.finance_excluded || booking.is_deleted || booking.status === 'cancelled') {
      classifiedNonBookingNet += runningNet;
      continue;
    }

    const bookingIsConfirmed = confirmedBookingIds
      ? confirmedBookingIds.has(bookingId)
      : Boolean(booking?.settlement_confirmed_at);
    const bucket = bookingIsConfirmed
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
    const knownSupplierPayable = totalCost > 0 ? Math.max(0, totalCost - withdrawals) : 0;
    if (totalCost > 0) bucket.knownSupplierPayable += knownSupplierPayable;
    else bucket.costMissingCount += 1;
    // Until final settlement, protect whichever is larger: refundable customer
    // cash still held or the known amount still owed to the supplier.
    bucket.cashReserveRequired += Math.max(Math.max(0, runningNet), knownSupplierPayable);
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
    .reduce((sum, bucket) => sum + bucket.cashNet, 0) + classifiedNonBookingNet;
  const openBuckets = [buckets.preDeparture, buckets.departedUnsettled, buckets.dateMissing];

  return {
    referenceDate,
    ...buckets,
    openCustomerFundsHeld: openBuckets.reduce((sum, bucket) => sum + bucket.customerFundsHeld, 0),
    openCompanyAdvanceOutstanding: openBuckets.reduce((sum, bucket) => sum + bucket.companyAdvanceOutstanding, 0),
    openCompanyPrefundingRequired: openBuckets.reduce((sum, bucket) => sum + bucket.companyPrefundingRequired, 0),
    openKnownSupplierPayable: openBuckets.reduce((sum, bucket) => sum + bucket.knownSupplierPayable, 0),
    openCashReserveRequired: openBuckets.reduce((sum, bucket) => sum + bucket.cashReserveRequired, 0),
    unallocatedTravelCount,
    overallocatedTravelCount,
    unallocatedTravelNet,
    classifiedNonBookingNet,
    travelCashNet,
    reconciliationDifference: travelCashNet - allocatedCashNet - unallocatedTravelNet,
  };
}

const TRAVEL_ACTION_STATUSES = new Set(['review', 'unmatched', 'error']);

/**
 * Counts transaction rows that need an operator's attention. A row is counted
 * once even when it has both a review status and an allocation mismatch.
 */
export function travelMemoOrAllocationActionIds(params: {
  transactions: BankAccountRealityRow[];
  allocations: BookingCashAllocationRow[];
}): string[] {
  const allocatedByTransaction = new Map<string, number>();
  for (const allocation of params.allocations) {
    allocatedByTransaction.set(
      allocation.bank_transaction_id,
      (allocatedByTransaction.get(allocation.bank_transaction_id) ?? 0) + money(allocation.allocated_amount),
    );
  }

  return params.transactions.flatMap(transaction => {
    if (!transaction.id || transaction.settlement_scope !== 'travel' || money(transaction.amount) <= 0) return [];
    const needsStatusReview = TRAVEL_ACTION_STATUSES.has(transaction.match_status ?? '');
    const hasAllocationMismatch = (allocatedByTransaction.get(transaction.id) ?? 0) !== money(transaction.amount);
    return needsStatusReview || hasAllocationMismatch ? [transaction.id] : [];
  });
}

export function countTravelMemoOrAllocationActions(params: {
  transactions: BankAccountRealityRow[];
  allocations: BookingCashAllocationRow[];
}): number {
  return travelMemoOrAllocationActionIds(params).length;
}

const OPERATING_INCOME_CATEGORIES = new Set([
  '매출', '영업수익', '이자수익', '정부지원금', '기타수익',
]);

const OPERATING_EXPENSE_CATEGORIES = new Set([
  '광고선전비', '급여', '기타 영업비용', '보험료', '복리후생비', '소모품비',
  '여비교통비', '임차료', '지급수수료', '차량유지비', '통신비', '수도광열비',
  '운반비', '도서인쇄비', '접대비', '외주용역비', '지급임차료', '출장비',
  '수선비', '교육훈련비', '감가상각비',
]);

const TAX_CATEGORIES = new Set([
  '법인세', '부가가치세', '부가세', '원천세', '세금과공과',
]);

function signedAmount(row: BankAccountRealityRow): number {
  return isDeposit(row) ? money(row.amount) : -money(row.amount);
}

function koreaMonth(input: Date | string): string {
  return koreaDate(input).slice(0, 7);
}

function monthSequence(referenceDate: Date | string, count: number): string[] {
  const [year, month] = koreaMonth(referenceDate).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function classifyNonTravelProfitRow(row: BankAccountRealityRow): NonTravelProfitClass {
  if (row.resolved_classification) {
    if (row.resolved_classification === 'company_expense' || row.resolved_classification === 'company_travel') return 'operating_expense';
    if (row.resolved_classification === 'other_income') return 'operating_income';
    if (row.resolved_classification === 'tax') return 'tax_payment';
    if (row.resolved_classification === 'capital' || row.resolved_classification === 'transfer') return 'financing';
    if (row.resolved_classification === 'refund' || row.resolved_classification === 'owner_draw') return 'pass_through';
    return 'review';
  }

  const memo = (row.memo ?? '').normalize('NFKC').trim();
  const category = (row.provider_category ?? '').normalize('NFKC').trim();

  // Refunds and cancellations are cash reversals, not new revenue or expense.
  if (/취소|환불/.test(memo)) return 'pass_through';
  if (/자본금|차입금|대여금|내부\s*이체|계좌\s*이체/.test(memo)) return 'financing';
  if (row.provider_is_unclassified === true) return 'review';
  if (TAX_CATEGORIES.has(category) && !isDeposit(row)) return 'tax_payment';
  if (OPERATING_INCOME_CATEGORIES.has(category) && isDeposit(row)) return 'operating_income';
  if (OPERATING_EXPENSE_CATEGORIES.has(category) && !isDeposit(row)) return 'operating_expense';
  return 'review';
}

function classifyAllocationTarget(
  target: BookingCashAllocationRow['target_type'],
): NonTravelProfitClass | null {
  if (!target || target === 'booking') return null;
  if (target === 'bank_fee' || target === 'company_expense' || target === 'company_travel') return 'operating_expense';
  if (target === 'other_income') return 'operating_income';
  if (target === 'tax') return 'tax_payment';
  if (target === 'capital' || target === 'transfer') return 'financing';
  if (target === 'customer_refund' || target === 'owner_draw') return 'pass_through';
  return 'review';
}

/**
 * Produces the owner-facing cash-profit view. "Safe to withdraw" is capped by
 * both unspent earned profit and cash left after protecting open-trip money.
 * Unknown supplier costs or unclassified cash block withdrawal rather than
 * turning customer advances or financing into apparent profit.
 */
export function calculateBankProfitErp(params: {
  bankSummary: BankAccountRealitySummary;
  bookingCash: BookingCashPositionSummary;
  transactions: BankAccountRealityRow[];
  allocations: BookingCashAllocationRow[];
  bookings: BookingCashBookingRow[];
  confirmedSettlementItems?: SettlementProfitSnapshot[];
  referenceDate?: Date | string;
  months?: number;
  taxRate?: number;
}): BankProfitErpSummary {
  const referenceDate = params.referenceDate ?? new Date();
  const months = Math.max(1, Math.min(36, Math.trunc(params.months ?? 12)));
  const taxRate = Math.max(0, Math.min(1, Number(params.taxRate ?? 0.1)));
  const monthlyMap = new Map<string, MonthlyProfitPoint>(monthSequence(referenceDate, months).map(month => [month, {
    month,
    confirmedTravelProfit: 0,
    estimatedTaxReserve: 0,
    afterTaxTravelProfit: 0,
    classifiedOperatingIncome: 0,
    classifiedOperatingExpense: 0,
    provisionalOperatingCashResult: 0,
  }]));

  const allTransactionsById = new Map(params.transactions
    .filter(row => row.id)
    .map(row => [row.id as string, row]));
  const transactionById = new Map(params.transactions
    .filter(row => row.id && row.settlement_scope === 'travel')
    .map(row => [row.id as string, row]));
  const bookingById = new Map(params.bookings.map(row => [row.id, row]));
  const snapshotItems = params.confirmedSettlementItems;
  let confirmedTravelProfit = 0;
  let confirmedBookingCount = 0;

  if (snapshotItems) {
    confirmedBookingCount = snapshotItems.length;
    for (const item of snapshotItems) {
      const profit = money(item.cash_margin);
      confirmedTravelProfit += profit;
      const point = monthlyMap.get(koreaMonth(item.departure_date));
      if (point) point.confirmedTravelProfit += profit;
    }
  } else {
    const profitByBooking = new Map<string, number>();
    for (const allocation of params.allocations) {
      const transaction = transactionById.get(allocation.bank_transaction_id);
      if (!allocation.booking_id || !['booking', 'customer_refund'].includes(allocation.target_type ?? 'booking')) continue;
      const booking = bookingById.get(allocation.booking_id);
      if (!transaction || !booking?.settlement_confirmed_at) continue;
      const amount = isDeposit(transaction) ? money(allocation.allocated_amount) : -money(allocation.allocated_amount);
      profitByBooking.set(allocation.booking_id, (profitByBooking.get(allocation.booking_id) ?? 0) + amount);
    }
    confirmedBookingCount = profitByBooking.size;
    for (const [bookingId, profit] of profitByBooking) {
      const booking = bookingById.get(bookingId);
      const basisDate = booking?.departure_date || booking?.settlement_confirmed_at;
      confirmedTravelProfit += profit;
      if (!basisDate) continue;
      const point = monthlyMap.get(koreaMonth(basisDate));
      if (point) point.confirmedTravelProfit += profit;
    }
  }

  let classifiedOperatingIncome = 0;
  let classifiedOperatingExpense = 0;
  let actualTaxPayments = 0;
  let classificationReviewCount = 0;
  let classificationReviewGross = 0;
  let classificationReviewNet = 0;
  let financingCount = 0;
  let financingNet = 0;
  let passThroughCount = 0;
  let passThroughNet = 0;
  let nonTravelGross = 0;
  let protectedUnclassifiedInflows = 0;
  const allocatedByTransaction = new Map<string, number>();

  const applyClassification = (
    classification: NonTravelProfitClass,
    amount: number,
    signed: number,
    receivedAt: string,
  ) => {
    nonTravelGross += amount;
    const point = monthlyMap.get(koreaMonth(receivedAt));

    if (classification === 'operating_income') {
      classifiedOperatingIncome += amount;
      if (point) point.classifiedOperatingIncome += amount;
    } else if (classification === 'operating_expense') {
      classifiedOperatingExpense += amount;
      if (point) point.classifiedOperatingExpense += amount;
    } else if (classification === 'tax_payment') {
      actualTaxPayments += amount;
    } else if (classification === 'financing') {
      financingCount += 1;
      financingNet += signed;
    } else if (classification === 'pass_through') {
      passThroughCount += 1;
      passThroughNet += signed;
    } else {
      classificationReviewCount += 1;
      classificationReviewGross += amount;
      classificationReviewNet += signed;
      if (signed > 0) protectedUnclassifiedInflows += signed;
    }
  };

  for (const allocation of params.allocations) {
    const transaction = allTransactionsById.get(allocation.bank_transaction_id);
    const amount = money(allocation.allocated_amount);
    if (!transaction || amount <= 0) continue;
    allocatedByTransaction.set(
      allocation.bank_transaction_id,
      (allocatedByTransaction.get(allocation.bank_transaction_id) ?? 0) + amount,
    );
    const classification = classifyAllocationTarget(allocation.target_type);
    if (!classification) continue;
    applyClassification(
      classification,
      amount,
      isDeposit(transaction) ? amount : -amount,
      transaction.received_at,
    );
  }

  for (const row of params.transactions) {
    if (row.settlement_scope !== 'non_travel') continue;
    const allocated = row.id ? (allocatedByTransaction.get(row.id) ?? 0) : 0;
    const amount = Math.max(0, money(row.amount) - allocated);
    if (amount <= 0) continue;
    applyClassification(
      classifyNonTravelProfitRow(row),
      isDeposit(row) ? amount : amount,
      isDeposit(row) ? amount : -amount,
      row.received_at,
    );
  }

  for (const point of monthlyMap.values()) {
    point.estimatedTaxReserve = Math.round(Math.max(0, point.confirmedTravelProfit) * taxRate);
    point.afterTaxTravelProfit = point.confirmedTravelProfit - point.estimatedTaxReserve;
    point.provisionalOperatingCashResult = point.confirmedTravelProfit
      + point.classifiedOperatingIncome
      - point.classifiedOperatingExpense;
  }

  const estimatedTaxLiability = Math.round(Math.max(0, confirmedTravelProfit) * taxRate);
  const estimatedTaxReserve = Math.max(0, estimatedTaxLiability - actualTaxPayments);
  const afterTaxTravelProfit = confirmedTravelProfit - estimatedTaxLiability;
  const provisionalOperatingCashResult = confirmedTravelProfit
    + classifiedOperatingIncome
    - classifiedOperatingExpense;
  const provisionalAfterTaxOperatingCashResult = provisionalOperatingCashResult - estimatedTaxLiability;
  const protectedUnallocatedTravelCash = Math.max(0, params.bookingCash.unallocatedTravelNet);
  const protectedCustomerFunds = params.bookingCash.openCustomerFundsHeld;
  const unpaidSupplierCost = params.bookingCash.openKnownSupplierPayable;
  // A booking can use the customer cash already held to pay its remaining
  // supplier cost. Reserving both amounts would protect the same cash twice.
  const protectedTravelCash = params.bookingCash.openCashReserveRequired + protectedUnallocatedTravelCash;
  const liquidityAvailableAfterReserves = params.bankSummary.actualBalance
    - protectedTravelCash
    - estimatedTaxReserve
    - protectedUnclassifiedInflows;
  const earnedProfitAvailable = Math.max(0, afterTaxTravelProfit - classifiedOperatingExpense);
  const blockers: string[] = [];
  const openCostMissingCount = params.bookingCash.preDeparture.costMissingCount
    + params.bookingCash.departedUnsettled.costMissingCount
    + params.bookingCash.dateMissing.costMissingCount;
  if (openCostMissingCount > 0) blockers.push(`원가 미입력 예약 ${openCostMissingCount}건`);
  if (params.bookingCash.unallocatedTravelCount > 0) blockers.push(`미배정 여행거래 ${params.bookingCash.unallocatedTravelCount}건`);
  if (params.bookingCash.reconciliationDifference !== 0) blockers.push('여행 원장 대사 불일치');
  if (params.bankSummary.reconciliationDifference !== 0) blockers.push('통장 잔액 대사 불일치');
  const calculationStatus = blockers.length > 0 ? 'blocked' : 'clear';
  const safeToWithdraw = calculationStatus === 'clear'
    ? Math.max(0, Math.min(liquidityAvailableAfterReserves, earnedProfitAvailable))
    : 0;

  return {
    taxRate,
    confirmedTravelProfit,
    confirmedBookingCount,
    estimatedTaxLiability,
    estimatedTaxReserve,
    afterTaxTravelProfit,
    classifiedOperatingIncome,
    classifiedOperatingExpense,
    actualTaxPayments,
    provisionalOperatingCashResult,
    provisionalAfterTaxOperatingCashResult,
    protectedCustomerFunds,
    unpaidSupplierCost,
    protectedTravelCash,
    protectedUnallocatedTravelCash,
    protectedUnclassifiedInflows,
    liquidityAvailableAfterReserves,
    earnedProfitAvailable,
    safeToWithdraw,
    liquidityShortfall: Math.max(0, -liquidityAvailableAfterReserves),
    classificationReviewCount,
    classificationReviewGross,
    classificationReviewNet,
    classificationCoveragePercent: nonTravelGross > 0
      ? Math.round(((nonTravelGross - classificationReviewGross) / nonTravelGross) * 1000) / 10
      : 100,
    financingCount,
    financingNet,
    passThroughCount,
    passThroughNet,
    calculationStatus,
    blockers,
    monthly: [...monthlyMap.values()],
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
  allocations: BookingCashAllocationRow[] = [],
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

  const allocationsByTransaction = new Map<string, BookingCashAllocationRow[]>();
  for (const allocation of allocations) {
    if (!allocation.bank_transaction_id || money(allocation.allocated_amount) <= 0) continue;
    const current = allocationsByTransaction.get(allocation.bank_transaction_id) ?? [];
    current.push(allocation);
    allocationsByTransaction.set(allocation.bank_transaction_id, current);
  }

  const totals = rows.reduce((result, row) => {
    const amount = money(row.amount);
    const deposit = isDeposit(row) ? amount : 0;
    const withdrawal = isDeposit(row) ? 0 : amount;
    result.totalDeposits += deposit;
    result.totalWithdrawals += withdrawal;

    let remaining = amount;
    let travelAmount = 0;
    let nonTravelAmount = 0;
    for (const allocation of row.id ? (allocationsByTransaction.get(row.id) ?? []) : []) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, money(allocation.allocated_amount));
      if (allocated <= 0) continue;
      remaining -= allocated;
      const target = allocation.target_type
        ?? (allocation.booking_id ? 'booking' : null);
      const isTravel = target === 'booking'
        || target === 'customer_refund'
        || (target === 'unassigned' && row.settlement_scope !== 'non_travel')
        || (target == null && row.settlement_scope !== 'non_travel');
      if (isTravel) travelAmount += allocated;
      else nonTravelAmount += allocated;
    }
    if (remaining > 0) {
      if (row.settlement_scope === 'non_travel') nonTravelAmount += remaining;
      else travelAmount += remaining;
    }

    if (nonTravelAmount > 0) {
      result.nonTravelCount += 1;
      result.nonTravelDeposits += isDeposit(row) ? nonTravelAmount : 0;
      result.nonTravelWithdrawals += isDeposit(row) ? 0 : nonTravelAmount;
      if (needsNonTravelMemoReview(row)) result.memoReviewCount += 1;
    }
    if (travelAmount > 0) {
      result.travelCount += 1;
      result.travelDeposits += isDeposit(row) ? travelAmount : 0;
      result.travelWithdrawals += isDeposit(row) ? 0 : travelAmount;
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
