import { describe, expect, it } from 'vitest';

import {
  calculateBankAccountReality,
  calculateBookingCashPositions,
  needsNonTravelMemoReview,
  type BankAccountRealityRow,
} from './bank-account-reality';

describe('bank account reality', () => {
  it('separates booking settlement cash from non-travel bank movements', () => {
    const summary = calculateBankAccountReality([
      {
        transaction_type: '입금', amount: 142_759_918, received_at: '2026-02-05T13:09:00+09:00',
        settlement_scope: 'travel', account_number: '100038454128', balance_after: 142_759_918,
      },
      {
        transaction_type: '출금', amount: 107_862_274, received_at: '2026-07-30T14:09:00+09:00',
        settlement_scope: 'travel', account_number: '100038454128', balance_after: 34_897_644,
      },
      {
        transaction_type: '입금', amount: 6_813_142, received_at: '2026-07-31T17:43:00+09:00',
        settlement_scope: 'non_travel', account_number: '100038454128', balance_after: 41_710_786, memo: '기타',
      },
      {
        transaction_type: '출금', amount: 18_274_459, received_at: '2026-08-01T13:04:00+09:00',
        settlement_scope: 'non_travel', account_number: '100038454128', balance_after: 23_436_327, memo: '회사 경비',
      },
    ]);

    expect(summary).toMatchObject({
      transactionCount: 4,
      openingBalance: 0,
      totalDeposits: 149_573_060,
      totalWithdrawals: 126_136_733,
      travelNet: 34_897_644,
      nonTravelNet: -11_461_317,
      actualBalance: 23_436_327,
      computedBalance: 23_436_327,
      reconciliationDifference: 0,
    });
  });

  it('flags blank, refund, and malformed travel-like non-travel memos', () => {
    const row = (memo: string, unclassified = false): BankAccountRealityRow => ({
      transaction_type: '출금', amount: 1_000, received_at: '2026-08-01T00:00:00+09:00',
      settlement_scope: 'non_travel', memo, provider_is_unclassified: unclassified,
    });

    expect(needsNonTravelMemoReview(row(''))).toBe(true);
    expect(needsNonTravelMemoReview(row('취소환불'))).toBe(true);
    expect(needsNonTravelMemoReview(row('260505_서진혜-더투어'))).toBe(true);
    expect(needsNonTravelMemoReview(row('메타 광고'))).toBe(false);
    expect(needsNonTravelMemoReview(row('기타', true))).toBe(true);
  });

  it('separates held customer cash, company prefunding, pending settlement, and settled profit', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'fa-in', transaction_type: '입금', amount: 100, received_at: '2026-07-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'fa-out', transaction_type: '출금', amount: 40, received_at: '2026-07-02T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'fb-out', transaction_type: '출금', amount: 90, received_at: '2026-07-01T10:00:00+09:00', settlement_scope: 'travel' },
      { id: 'fb-in', transaction_type: '입금', amount: 80, received_at: '2026-07-02T10:00:00+09:00', settlement_scope: 'travel' },
      { id: 'past-in', transaction_type: '입금', amount: 200, received_at: '2026-06-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'past-out', transaction_type: '출금', amount: 150, received_at: '2026-06-02T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'settled-out', transaction_type: '출금', amount: 80, received_at: '2026-05-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'settled-in', transaction_type: '입금', amount: 100, received_at: '2026-05-02T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'undated-in', transaction_type: '입금', amount: 30, received_at: '2026-07-03T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'unallocated-in', transaction_type: '입금', amount: 10, received_at: '2026-07-04T09:00:00+09:00', settlement_scope: 'travel' },
    ];
    const allocations = transactions
      .filter(transaction => transaction.id !== 'unallocated-in')
      .map(transaction => ({
        bank_transaction_id: transaction.id as string,
        booking_id: transaction.id?.split('-')[0] === 'fa'
          ? 'future-a'
          : transaction.id?.split('-')[0] === 'fb'
            ? 'future-b'
            : transaction.id?.split('-')[0] === 'past'
              ? 'past'
              : transaction.id?.split('-')[0] === 'settled'
                ? 'settled'
                : 'undated',
        allocated_amount: transaction.amount,
      }));

    const summary = calculateBookingCashPositions({
      transactions,
      allocations,
      bookings: [
        { id: 'future-a', departure_date: '2026-08-04' },
        { id: 'future-b', departure_date: '2026-09-01' },
        { id: 'past', departure_date: '2026-07-01' },
        { id: 'settled', departure_date: '2026-06-01', settlement_confirmed_at: '2026-06-10T00:00:00+09:00' },
        { id: 'undated', departure_date: null },
      ],
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    expect(summary).toMatchObject({
      referenceDate: '2026-08-03',
      settled: { bookingCount: 1, cashNet: 20 },
      preDeparture: {
        bookingCount: 2,
        deposits: 180,
        withdrawals: 130,
        cashNet: 50,
        customerFundsHeld: 60,
        companyAdvanceOutstanding: 10,
        companyPrefundingRequired: 90,
        priceMissingCount: 2,
        costMissingCount: 2,
        knownCustomerReceivable: 0,
        knownSupplierPayable: 0,
      },
      departedUnsettled: { bookingCount: 1, cashNet: 50, customerFundsHeld: 50 },
      dateMissing: { bookingCount: 1, cashNet: 30, customerFundsHeld: 30 },
      openCustomerFundsHeld: 140,
      openCompanyAdvanceOutstanding: 10,
      openCompanyPrefundingRequired: 90,
      unallocatedTravelCount: 1,
      unallocatedTravelNet: 10,
      travelCashNet: 160,
      reconciliationDifference: 0,
    });
  });
});
