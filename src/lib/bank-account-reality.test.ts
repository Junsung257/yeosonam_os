import { describe, expect, it } from 'vitest';

import {
  calculateBankAccountReality,
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
});
