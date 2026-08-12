import { describe, expect, it } from 'vitest';

import {
  canCloseSettlementMonth,
  clobeSettlementKeyFromSourceMetadata,
  isFinanceBookingVisible,
  needsCustomerCashReceipt,
  suggestedExactBankFee,
  summarizeBookingCashBreakdown,
  validateBreakdownTotal,
} from './finance-settlement-v3';

describe('finance settlement v3', () => {
  it('reads the Clobe settlement key from the persisted source metadata', () => {
    expect(clobeSettlementKeyFromSourceMetadata({
      clobe_mcp: { settlement_key: ' 260806_\uc774\ub098\uc724_\ud22c\uc5b4\ud3f0 ' },
    })).toBe('260806_\uc774\ub098\uc724_\ud22c\uc5b4\ud3f0');
    expect(clobeSettlementKeyFromSourceMetadata({ clobe_mcp: {} })).toBeNull();
    expect(clobeSettlementKeyFromSourceMetadata(null)).toBeNull();
  });

  it('splits the 9.14m transfer without using the Kim Doyeon refund as Changwon University cost', () => {
    const summary = summarizeBookingCashBreakdown({
      bookingId: 'changwon',
      transactions: [
        { id: 'deposit', transaction_type: '입금', amount: 13_550_000 },
        { id: 'existing-payout', transaction_type: '출금', amount: 4_000_500 },
        { id: 'split-payout', transaction_type: '출금', amount: 9_140_000 },
      ],
      allocations: [
        { bank_transaction_id: 'deposit', booking_id: 'changwon', allocated_amount: 13_550_000, target_type: 'booking' },
        { bank_transaction_id: 'existing-payout', booking_id: 'changwon', allocated_amount: 4_000_500, target_type: 'booking' },
        { bank_transaction_id: 'split-payout', booking_id: 'changwon', allocated_amount: 7_640_000, target_type: 'booking' },
        { bank_transaction_id: 'split-payout', allocated_amount: 1_500_000, target_type: 'customer_refund' },
      ],
    });

    expect(summary.travelWithdrawals).toBe(11_640_500);
    expect(summary.cashMargin).toBe(1_909_500);
    expect(validateBreakdownTotal(9_140_000, [{ amount: 7_640_000 }, { amount: 1_500_000 }])).toEqual({
      allocated: 9_140_000,
      remaining: 0,
      exact: true,
    });
  });

  it('keeps a cancellation at zero while separating the bank fee', () => {
    const summary = summarizeBookingCashBreakdown({
      bookingId: 'cancelled',
      transactions: [
        { id: 'deposit', transaction_type: '입금', amount: 600_000 },
        { id: 'refund', transaction_type: '출금', amount: 600_500 },
      ],
      allocations: [
        { bank_transaction_id: 'deposit', booking_id: 'cancelled', allocated_amount: 600_000, target_type: 'booking' },
        { bank_transaction_id: 'refund', booking_id: 'cancelled', allocated_amount: 600_000, target_type: 'customer_refund' },
        { bank_transaction_id: 'refund', booking_id: 'cancelled', allocated_amount: 500, target_type: 'bank_fee' },
      ],
    });

    expect(summary.cashMargin).toBe(0);
    expect(summary.bankFees).toBe(500);
    expect(validateBreakdownTotal(600_500, [{ amount: 600_000 }, { amount: 500 }]).exact).toBe(true);
  });

  it('suggests only exact 500 or 1,000 won fee shortages without changing data', () => {
    expect(suggestedExactBankFee({ cashMargin: -500, customerRefunds: 0, bankFees: 0 })).toBe(500);
    expect(suggestedExactBankFee({ cashMargin: -1_000, customerRefunds: 0, bankFees: 0 })).toBe(1_000);
    expect(suggestedExactBankFee({ cashMargin: -501, customerRefunds: 0, bankFees: 0 })).toBeNull();
    expect(suggestedExactBankFee({ cashMargin: -500, customerRefunds: 500, bankFees: 0 })).toBeNull();
    expect(suggestedExactBankFee({ cashMargin: -1_000, customerRefunds: 0, bankFees: 1_000 })).toBeNull();
  });

  it('blocks normal close until every booking has an owner decision', () => {
    expect(canCloseSettlementMonth(['confirmed', 'pending'])).toMatchObject({ normal: false, conditional: false });
    expect(canCloseSettlementMonth(['confirmed', 'deferred'])).toMatchObject({ normal: false, conditional: true });
    expect(canCloseSettlementMonth(['confirmed', 'customer_cancelled', 'invalid_booking'])).toMatchObject({ normal: true, conditional: false });
  });

  it('keeps deleted and cancelled bookings out of the normal finance queue', () => {
    expect(isFinanceBookingVisible({ isDeleted: true })).toBe(false);
    expect(isFinanceBookingVisible({ bookingStatus: 'cancelled' })).toBe(false);
    expect(isFinanceBookingVisible({ financeExcluded: true })).toBe(false);
    expect(isFinanceBookingVisible({ isDeleted: true, includeExcluded: true })).toBe(true);
    expect(isFinanceBookingVisible({ bookingStatus: 'confirmed' })).toBe(true);
  });

  it('does not create a cash-receipt task before the receipt target price is confirmed', () => {
    expect(needsCustomerCashReceipt({
      paidAmount: 719_000,
      receiptTargetAmount: 0,
      receiptStatus: 'NOT_ISSUED',
    })).toBe(false);
    expect(needsCustomerCashReceipt({
      paidAmount: 719_000,
      receiptTargetAmount: 719_000,
      receiptStatus: 'NOT_ISSUED',
    })).toBe(true);
    expect(needsCustomerCashReceipt({
      paidAmount: 0,
      receiptTargetAmount: 719_000,
      receiptStatus: 'NOT_ISSUED',
    })).toBe(false);
  });
});
