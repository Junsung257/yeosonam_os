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
  openCashReserveRequired: number;
  unallocatedTravelCount: number;
  overallocatedTravelCount: number;
  unallocatedTravelNet: number;
  travelCashNet: number;
  reconciliationDifference: number;
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
  estimatedTaxReserve: number;
  afterTaxTravelProfit: number;
  classifiedOperatingIncome: number;
  classifiedOperatingExpense: number;
  actualTaxPayments: number;
  provisionalOperatingCashResult: number;
  provisionalAfterTaxOperatingCashResult: number;
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
    .reduce((sum, bucket) => sum + bucket.cashNet, 0);
  const openBuckets = [buckets.preDeparture, buckets.departedUnsettled, buckets.dateMissing];

  return {
    referenceDate,
    ...buckets,
    openCustomerFundsHeld: openBuckets.reduce((sum, bucket) => sum + bucket.customerFundsHeld, 0),
    openCompanyAdvanceOutstanding: openBuckets.reduce((sum, bucket) => sum + bucket.companyAdvanceOutstanding, 0),
    openCompanyPrefundingRequired: openBuckets.reduce((sum, bucket) => sum + bucket.companyPrefundingRequired, 0),
    openCashReserveRequired: openBuckets.reduce((sum, bucket) => sum + bucket.cashReserveRequired, 0),
    unallocatedTravelCount,
    overallocatedTravelCount,
    unallocatedTravelNet,
    travelCashNet,
    reconciliationDifference: travelCashNet - allocatedCashNet - unallocatedTravelNet,
  };
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

  const transactionById = new Map(params.transactions
    .filter(row => row.id && row.settlement_scope === 'travel')
    .map(row => [row.id as string, row]));
  const bookingById = new Map(params.bookings.map(row => [row.id, row]));
  const profitByBooking = new Map<string, number>();

  for (const allocation of params.allocations) {
    const transaction = transactionById.get(allocation.bank_transaction_id);
    const booking = bookingById.get(allocation.booking_id);
    if (!transaction || !booking?.settlement_confirmed_at) continue;
    const amount = isDeposit(transaction) ? money(allocation.allocated_amount) : -money(allocation.allocated_amount);
    profitByBooking.set(allocation.booking_id, (profitByBooking.get(allocation.booking_id) ?? 0) + amount);
  }

  for (const [bookingId, profit] of profitByBooking) {
    const booking = bookingById.get(bookingId);
    const basisDate = booking?.departure_date || booking?.settlement_confirmed_at;
    if (!basisDate) continue;
    const point = monthlyMap.get(koreaMonth(basisDate));
    if (point) point.confirmedTravelProfit += profit;
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

  for (const row of params.transactions) {
    if (row.settlement_scope !== 'non_travel') continue;
    const amount = money(row.amount);
    if (amount <= 0) continue;
    nonTravelGross += amount;
    const signed = signedAmount(row);
    const classification = classifyNonTravelProfitRow(row);
    const point = monthlyMap.get(koreaMonth(row.received_at));

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
    }
  }

  let trendTaxReserve = 0;
  for (const point of monthlyMap.values()) {
    point.estimatedTaxReserve = Math.round(Math.max(0, point.confirmedTravelProfit) * taxRate);
    point.afterTaxTravelProfit = point.confirmedTravelProfit - point.estimatedTaxReserve;
    point.provisionalOperatingCashResult = point.confirmedTravelProfit
      + point.classifiedOperatingIncome
      - point.classifiedOperatingExpense;
    trendTaxReserve += point.estimatedTaxReserve;
  }

  const confirmedTravelProfit = params.bookingCash.settled.cashNet;
  const estimatedTaxReserve = trendTaxReserve || Math.round(Math.max(0, confirmedTravelProfit) * taxRate);
  const afterTaxTravelProfit = confirmedTravelProfit - estimatedTaxReserve;
  const provisionalOperatingCashResult = confirmedTravelProfit
    + classifiedOperatingIncome
    - classifiedOperatingExpense;
  const provisionalAfterTaxOperatingCashResult = provisionalOperatingCashResult - estimatedTaxReserve;
  const protectedUnallocatedTravelCash = Math.max(0, params.bookingCash.unallocatedTravelNet);
  const protectedTravelCash = params.bookingCash.openCashReserveRequired + protectedUnallocatedTravelCash;
  const protectedUnclassifiedInflows = Math.max(0, classificationReviewNet) + Math.max(0, passThroughNet);
  const liquidityAvailableAfterReserves = params.bankSummary.actualBalance
    - protectedTravelCash
    - estimatedTaxReserve
    - protectedUnclassifiedInflows;
  const earnedProfitAvailable = Math.max(0, provisionalAfterTaxOperatingCashResult);
  const blockers: string[] = [];
  const openCostMissingCount = params.bookingCash.preDeparture.costMissingCount
    + params.bookingCash.departedUnsettled.costMissingCount
    + params.bookingCash.dateMissing.costMissingCount;
  if (openCostMissingCount > 0) blockers.push(`원가 미입력 예약 ${openCostMissingCount}건`);
  if (params.bookingCash.unallocatedTravelCount > 0) blockers.push(`미배정 여행거래 ${params.bookingCash.unallocatedTravelCount}건`);
  if (params.bookingCash.reconciliationDifference !== 0) blockers.push('여행 원장 대사 불일치');
  if (params.bankSummary.reconciliationDifference !== 0) blockers.push('통장 잔액 대사 불일치');
  if (classificationReviewCount > 0) blockers.push(`여행 외 분류대기 ${classificationReviewCount}건`);
  const calculationStatus = blockers.length > 0 ? 'blocked' : 'clear';
  const safeToWithdraw = calculationStatus === 'clear'
    ? Math.max(0, Math.min(liquidityAvailableAfterReserves, earnedProfitAvailable))
    : 0;

  return {
    taxRate,
    confirmedTravelProfit,
    confirmedBookingCount: params.bookingCash.settled.bookingCount,
    estimatedTaxReserve,
    afterTaxTravelProfit,
    classifiedOperatingIncome,
    classifiedOperatingExpense,
    actualTaxPayments,
    provisionalOperatingCashResult,
    provisionalAfterTaxOperatingCashResult,
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
