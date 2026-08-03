export type BankSettlementScope = 'travel' | 'non_travel';

export const YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER = '100038454128';

export interface BankAccountRealityRow {
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
}

function money(value: number | null | undefined): number {
  return Math.round(Number(value) || 0);
}

function isDeposit(row: BankAccountRealityRow): boolean {
  return row.transaction_type === '입금';
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
