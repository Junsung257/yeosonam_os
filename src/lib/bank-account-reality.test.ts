import { describe, expect, it } from 'vitest';

import {
  calculateBankAccountReality,
  calculateBankProfitErp,
  calculateBookingCashPositions,
  classifyNonTravelProfitRow,
  countTravelMemoOrAllocationActions,
  needsNonTravelMemoReview,
  travelMemoOrAllocationActionIds,
  type BankAccountRealityRow,
} from './bank-account-reality';

describe('bank account reality', () => {
  it('splits a refund and bank fee between travel cash and company expense', () => {
    const summary = calculateBankAccountReality([
      {
        id: 'cancel-deposit',
        transaction_type: '입금',
        amount: 600_000,
        received_at: '2026-06-20T10:00:00+09:00',
        settlement_scope: 'travel',
      },
      {
        id: 'cancel-refund',
        transaction_type: '출금',
        amount: 600_500,
        received_at: '2026-06-23T10:00:00+09:00',
        settlement_scope: 'travel',
      },
    ], [
      { bank_transaction_id: 'cancel-deposit', booking_id: 'booking-1', allocated_amount: 600_000, target_type: 'booking' },
      { bank_transaction_id: 'cancel-refund', booking_id: 'booking-1', allocated_amount: 600_000, target_type: 'customer_refund' },
      { bank_transaction_id: 'cancel-refund', booking_id: null, allocated_amount: 500, target_type: 'bank_fee' },
    ]);

    expect(summary.travelDeposits).toBe(600_000);
    expect(summary.travelWithdrawals).toBe(600_000);
    expect(summary.travelNet).toBe(0);
    expect(summary.nonTravelWithdrawals).toBe(500);
    expect(summary.nonTravelNet).toBe(-500);
    expect(summary.computedBalance).toBe(-500);
  });

  it('uses a confirmed company allocation instead of a stale transaction scope', () => {
    const summary = calculateBankAccountReality([{
      id: 'company-expense',
      transaction_type: '출금',
      amount: 55_060,
      received_at: '2026-08-07T05:38:08+09:00',
      settlement_scope: 'travel',
    }], [{
      bank_transaction_id: 'company-expense',
      booking_id: null,
      allocated_amount: 55_060,
      target_type: 'company_expense',
    }]);

    expect(summary.travelCount).toBe(0);
    expect(summary.nonTravelCount).toBe(1);
    expect(summary.nonTravelNet).toBe(-55_060);
  });

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

  it('counts each travel transaction needing memo or allocation review once', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'review-full', transaction_type: '입금', amount: 100, received_at: '2026-08-01', settlement_scope: 'travel', match_status: 'review' },
      { id: 'auto-full', transaction_type: '입금', amount: 200, received_at: '2026-08-01', settlement_scope: 'travel', match_status: 'auto' },
      { id: 'review-short', transaction_type: '출금', amount: 300, received_at: '2026-08-01', settlement_scope: 'travel', match_status: 'review' },
      { id: 'auto-short', transaction_type: '출금', amount: 400, received_at: '2026-08-01', settlement_scope: 'travel', match_status: 'matched' },
      { id: 'company-review', transaction_type: '출금', amount: 500, received_at: '2026-08-01', settlement_scope: 'non_travel', match_status: 'review' },
    ];
    const allocations = [
      { bank_transaction_id: 'review-full', booking_id: 'a', allocated_amount: 100 },
      { bank_transaction_id: 'auto-full', booking_id: 'b', allocated_amount: 200 },
      { bank_transaction_id: 'review-short', booking_id: 'c', allocated_amount: 200 },
      { bank_transaction_id: 'auto-short', booking_id: 'd', allocated_amount: 399 },
    ];

    expect(countTravelMemoOrAllocationActions({ transactions, allocations })).toBe(3);
    expect(travelMemoOrAllocationActionIds({ transactions, allocations })).toEqual([
      'review-full',
      'review-short',
      'auto-short',
    ]);
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
      openKnownSupplierPayable: 0,
      openCashReserveRequired: 140,
      unallocatedTravelCount: 1,
      unallocatedTravelNet: 10,
      travelCashNet: 160,
      reconciliationDifference: 0,
    });
  });

  it('treats legacy confirmation as pending when current month-close snapshots are supplied', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'legacy-in', transaction_type: '입금', amount: 1_000, received_at: '2026-07-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'snapshot-in', transaction_type: '입금', amount: 2_000, received_at: '2026-07-02T09:00:00+09:00', settlement_scope: 'travel' },
    ];
    const allocations = [
      { bank_transaction_id: 'legacy-in', booking_id: 'legacy', allocated_amount: 1_000 },
      { bank_transaction_id: 'snapshot-in', booking_id: 'snapshot', allocated_amount: 2_000 },
    ];
    const bookings = [
      { id: 'legacy', departure_date: '2026-07-01', settlement_confirmed_at: '2026-07-03T00:00:00+09:00' },
      { id: 'snapshot', departure_date: '2026-07-02', settlement_confirmed_at: '2026-07-03T00:00:00+09:00' },
    ];

    const summary = calculateBookingCashPositions({
      transactions,
      allocations,
      bookings,
      confirmedBookingIds: ['snapshot'],
      referenceDate: '2026-08-12T00:00:00+09:00',
    });

    expect(summary.settled).toMatchObject({ bookingCount: 1, cashNet: 2_000 });
    expect(summary.departedUnsettled).toMatchObject({ bookingCount: 1, cashNet: 1_000 });
  });

  it('keeps refunds and financing out of company profit classification', () => {
    const row = (overrides: Partial<BankAccountRealityRow>): BankAccountRealityRow => ({
      transaction_type: '입금',
      amount: 1_000,
      received_at: '2026-08-01T00:00:00+09:00',
      settlement_scope: 'non_travel',
      ...overrides,
    });

    expect(classifyNonTravelProfitRow(row({ memo: '자본금', provider_is_unclassified: true }))).toBe('financing');
    expect(classifyNonTravelProfitRow(row({ memo: '취소환불', provider_category: '매출' }))).toBe('pass_through');
    expect(classifyNonTravelProfitRow(row({ provider_category: '이자수익' }))).toBe('operating_income');
    expect(classifyNonTravelProfitRow(row({ transaction_type: '출금', provider_category: '지급수수료' }))).toBe('operating_expense');
    expect(classifyNonTravelProfitRow(row({ provider_category: '계정 없는 입금', provider_is_unclassified: true }))).toBe('review');
  });

  it('reconciles a cancelled booking while treating its bank fee as company expense', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'cancel-in', transaction_type: '입금', amount: 600_000, received_at: '2026-06-20T10:00:00+09:00', settlement_scope: 'travel' },
      { id: 'cancel-out', transaction_type: '출금', amount: 600_500, received_at: '2026-06-23T10:00:00+09:00', settlement_scope: 'travel' },
    ];
    const allocations = [
      { bank_transaction_id: 'cancel-in', booking_id: 'cancelled', allocated_amount: 600_000, target_type: 'booking' as const },
      { bank_transaction_id: 'cancel-out', booking_id: 'cancelled', allocated_amount: 600_000, target_type: 'customer_refund' as const },
      { bank_transaction_id: 'cancel-out', booking_id: 'cancelled', allocated_amount: 500, target_type: 'bank_fee' as const },
    ];
    const bookings = [{
      id: 'cancelled',
      departure_date: '2026-06-23',
      status: 'cancelled',
      finance_excluded: true,
    }];
    const bankSummary = calculateBankAccountReality(transactions);
    const bookingCash = calculateBookingCashPositions({ transactions, allocations, bookings });
    const profit = calculateBankProfitErp({
      bankSummary,
      bookingCash,
      transactions,
      allocations,
      bookings,
      confirmedSettlementItems: [],
      referenceDate: '2026-08-06T00:00:00+09:00',
    });

    expect(bookingCash).toMatchObject({
      openCustomerFundsHeld: 0,
      classifiedNonBookingNet: -500,
      travelCashNet: -500,
      reconciliationDifference: 0,
    });
    expect(profit).toMatchObject({
      confirmedTravelProfit: 0,
      classifiedOperatingExpense: 500,
      passThroughCount: 1,
      passThroughNet: -600_000,
    });
  });

  it('caps withdrawable cash by both protected trip money and earned after-tax profit', () => {
    const travelTransactions: BankAccountRealityRow[] = [
      { id: 'open-in', transaction_type: '입금', amount: 100, received_at: '2026-07-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'settled-in', transaction_type: '입금', amount: 100, received_at: '2026-05-02T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'settled-out', transaction_type: '출금', amount: 80, received_at: '2026-05-01T09:00:00+09:00', settlement_scope: 'travel' },
    ];
    const nonTravelTransactions: BankAccountRealityRow[] = [
      { transaction_type: '입금', amount: 5, received_at: '2026-07-03T09:00:00+09:00', settlement_scope: 'non_travel', provider_category: '이자수익' },
      { transaction_type: '출금', amount: 25, received_at: '2026-07-04T09:00:00+09:00', settlement_scope: 'non_travel', provider_category: '지급수수료' },
      { transaction_type: '입금', amount: 100, received_at: '2026-07-05T09:00:00+09:00', settlement_scope: 'non_travel', memo: '자본금', provider_is_unclassified: true },
      { transaction_type: '입금', amount: 30, received_at: '2026-07-06T09:00:00+09:00', settlement_scope: 'non_travel', memo: '취소환불' },
      { transaction_type: '출금', amount: 10, received_at: '2026-07-07T09:00:00+09:00', settlement_scope: 'non_travel', provider_is_unclassified: true },
    ];
    const transactions = [...travelTransactions, ...nonTravelTransactions];
    const allocations = travelTransactions.map(transaction => ({
      bank_transaction_id: transaction.id as string,
      booking_id: transaction.id?.startsWith('open') ? 'open' : 'settled',
      allocated_amount: transaction.amount,
    }));
    const bookings = [
      { id: 'open', departure_date: '2026-09-01' },
      { id: 'settled', departure_date: '2026-06-01', settlement_confirmed_at: '2026-06-10T00:00:00+09:00' },
    ];
    const bankSummary = calculateBankAccountReality(transactions);
    const bookingCash = calculateBookingCashPositions({
      transactions,
      allocations,
      bookings,
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    const summary = calculateBankProfitErp({
      bankSummary,
      bookingCash,
      transactions,
      allocations,
      bookings,
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    expect(summary).toMatchObject({
      confirmedTravelProfit: 20,
      confirmedBookingCount: 1,
      estimatedTaxLiability: 2,
      estimatedTaxReserve: 2,
      afterTaxTravelProfit: 18,
      classifiedOperatingIncome: 5,
      classifiedOperatingExpense: 25,
      provisionalOperatingCashResult: 0,
      provisionalAfterTaxOperatingCashResult: -2,
      protectedCustomerFunds: 100,
      unpaidSupplierCost: 0,
      protectedTravelCash: 100,
      protectedUnclassifiedInflows: 0,
      liquidityAvailableAfterReserves: 118,
      earnedProfitAvailable: 0,
      safeToWithdraw: 0,
      classificationReviewCount: 1,
      classificationReviewGross: 10,
      classificationReviewNet: -10,
      financingCount: 1,
      financingNet: 100,
      passThroughCount: 1,
      passThroughNet: 30,
      calculationStatus: 'blocked',
    });
    expect(summary.blockers).toEqual(expect.arrayContaining([
      '원가 미입력 예약 1건',
    ]));
    expect(summary.monthly.find(point => point.month === '2026-06')).toMatchObject({
      confirmedTravelProfit: 20,
      estimatedTaxReserve: 2,
      afterTaxTravelProfit: 18,
    });
  });

  it('uses immutable settlement snapshots instead of silently recomputing closed profit', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'in', transaction_type: '입금', amount: 150, received_at: '2026-07-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'out', transaction_type: '출금', amount: 40, received_at: '2026-07-02T09:00:00+09:00', settlement_scope: 'travel' },
    ];
    const allocations = transactions.map(transaction => ({
      bank_transaction_id: transaction.id as string,
      booking_id: 'closed-booking',
      allocated_amount: transaction.amount,
    }));
    const bookings = [{
      id: 'closed-booking',
      departure_date: '2026-07-15',
      settlement_confirmed_at: '2026-08-01T00:00:00+09:00',
    }];
    const bankSummary = calculateBankAccountReality(transactions);
    const bookingCash = calculateBookingCashPositions({ transactions, allocations, bookings });

    const summary = calculateBankProfitErp({
      bankSummary,
      bookingCash,
      transactions,
      allocations,
      bookings,
      confirmedSettlementItems: [{
        booking_id: 'closed-booking',
        departure_date: '2026-07-15',
        cash_margin: 60,
      }],
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    expect(summary.confirmedTravelProfit).toBe(60);
    expect(summary.monthly.find(point => point.month === '2026-07')?.confirmedTravelProfit).toBe(60);
  });

  it('calculates safe cash from bank liquidity and earned profit using the smaller cap', () => {
    const transactions: BankAccountRealityRow[] = [
      { id: 'closed-in', transaction_type: '입금', amount: 1_000, received_at: '2026-07-01T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'closed-out', transaction_type: '출금', amount: 600, received_at: '2026-07-02T09:00:00+09:00', settlement_scope: 'travel' },
      { id: 'open-in', transaction_type: '입금', amount: 500, received_at: '2026-08-01T09:00:00+09:00', settlement_scope: 'travel' },
      { transaction_type: '출금', amount: 50, received_at: '2026-08-02T09:00:00+09:00', settlement_scope: 'non_travel', resolved_classification: 'company_expense' },
      { transaction_type: '입금', amount: 70, received_at: '2026-08-02T10:00:00+09:00', settlement_scope: 'non_travel', resolved_classification: 'review' },
      { transaction_type: '출금', amount: 20, received_at: '2026-08-02T11:00:00+09:00', settlement_scope: 'non_travel', resolved_classification: 'tax' },
    ];
    const allocations = [
      { bank_transaction_id: 'closed-in', booking_id: 'closed', allocated_amount: 1_000 },
      { bank_transaction_id: 'closed-out', booking_id: 'closed', allocated_amount: 600 },
      { bank_transaction_id: 'open-in', booking_id: 'open', allocated_amount: 500 },
    ];
    const bookings = [
      { id: 'closed', departure_date: '2026-07-15', settlement_confirmed_at: '2026-08-01T00:00:00+09:00', total_cost: 600 },
      { id: 'open', departure_date: '2026-09-15', total_cost: 300 },
    ];
    const bankSummary = calculateBankAccountReality(transactions);
    const bookingCash = calculateBookingCashPositions({
      transactions,
      allocations,
      bookings,
      referenceDate: '2026-08-03T10:30:15+09:00',
    });
    const summary = calculateBankProfitErp({
      bankSummary,
      bookingCash,
      transactions,
      allocations,
      bookings,
      confirmedSettlementItems: [{ booking_id: 'closed', departure_date: '2026-07-15', cash_margin: 400 }],
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    expect(summary).toMatchObject({
      confirmedTravelProfit: 400,
      estimatedTaxLiability: 40,
      actualTaxPayments: 20,
      estimatedTaxReserve: 20,
      protectedCustomerFunds: 500,
      unpaidSupplierCost: 300,
      protectedTravelCash: 500,
      protectedUnclassifiedInflows: 70,
      liquidityAvailableAfterReserves: 310,
      earnedProfitAvailable: 310,
      safeToWithdraw: 310,
      calculationStatus: 'clear',
    });
  });

  it('counts open bookings with no bank allocation so missing supplier cost cannot disappear', () => {
    const summary = calculateBookingCashPositions({
      transactions: [],
      allocations: [],
      bookings: [{ id: 'not-paid', departure_date: '2026-09-01', total_price: 500, total_cost: null }],
      referenceDate: '2026-08-03T10:30:15+09:00',
    });

    expect(summary.preDeparture).toMatchObject({
      bookingCount: 1,
      priceMissingCount: 0,
      costMissingCount: 1,
      knownCustomerReceivable: 500,
    });
  });
});
