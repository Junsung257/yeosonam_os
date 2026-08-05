import { describe, expect, it } from 'vitest';

import {
  assertCompletedSettlementMonth,
  calculateMonthlySettlementClosePreview,
  previousCompletedKoreaMonth,
  settlementMonthBounds,
} from './monthly-settlement-close';

describe('monthly settlement close', () => {
  it('calculates Korean previous month and calendar bounds', () => {
    expect(previousCompletedKoreaMonth('2026-08-05T01:00:00Z')).toBe('2026-07');
    expect(settlementMonthBounds('2026-02')).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
    expect(() => assertCompletedSettlementMonth('2026-08', '2026-08-05T01:00:00Z')).toThrow(
      '아직 끝나지 않은 출발 월',
    );
  });

  it('closes only positive, fully allocated, unconfirmed bookings through the selected month', () => {
    const preview = calculateMonthlySettlementClosePreview({
      month: '2026-07',
      transactions: [
        { id: 'deposit-ok', transaction_type: '입금', amount: 1_000_000 },
        { id: 'withdraw-ok', transaction_type: '출금', amount: 900_000 },
        { id: 'deposit-loss', transaction_type: '입금', amount: 500_000 },
        { id: 'withdraw-loss', transaction_type: '출금', amount: 501_000 },
        { id: 'deposit-drift', transaction_type: '입금', amount: 200_000 },
        { id: 'deposit-confirmed', transaction_type: '입금', amount: 300_000 },
        { id: 'withdraw-confirmed', transaction_type: '출금', amount: 250_000 },
        { id: 'deposit-future', transaction_type: '입금', amount: 700_000 },
      ],
      allocations: [
        { bank_transaction_id: 'deposit-ok', booking_id: 'ok', allocated_amount: 1_000_000 },
        { bank_transaction_id: 'withdraw-ok', booking_id: 'ok', allocated_amount: 900_000 },
        { bank_transaction_id: 'deposit-loss', booking_id: 'loss', allocated_amount: 500_000 },
        { bank_transaction_id: 'withdraw-loss', booking_id: 'loss', allocated_amount: 501_000 },
        { bank_transaction_id: 'deposit-drift', booking_id: 'drift', allocated_amount: 100_000 },
        { bank_transaction_id: 'deposit-confirmed', booking_id: 'confirmed', allocated_amount: 300_000 },
        { bank_transaction_id: 'withdraw-confirmed', booking_id: 'confirmed', allocated_amount: 250_000 },
        { bank_transaction_id: 'deposit-future', booking_id: 'future', allocated_amount: 700_000 },
      ],
      bookings: [
        { id: 'ok', booking_no: 'BK-OK', departure_date: '2026-07-15', status: 'confirmed' },
        { id: 'loss', booking_no: 'BK-LOSS', departure_date: '2026-07-19', status: 'confirmed' },
        { id: 'drift', booking_no: 'BK-DRIFT', departure_date: '2026-06-01', status: 'confirmed' },
        { id: 'none', booking_no: 'BK-NONE', departure_date: '2026-05-01', status: 'completed' },
        {
          id: 'confirmed',
          booking_no: 'BK-DONE',
          departure_date: '2026-04-01',
          status: 'completed',
          settlement_confirmed_at: '2026-04-10T00:00:00Z',
        },
        { id: 'future', booking_no: 'BK-FUTURE', departure_date: '2026-08-01', status: 'confirmed' },
        { id: 'cancelled', booking_no: 'BK-CANCEL', departure_date: '2026-03-01', status: 'cancelled' },
      ],
    });

    expect(preview.eligible.map(row => row.bookingNo)).toEqual(['BK-OK']);
    expect(preview.candidateFingerprint).toBe('ok:1000000:900000');
    expect(preview.summary.eligibleProfit).toBe(100_000);
    expect(preview.summary.alreadyConfirmedCount).toBe(1);
    expect(preview.summary.alreadyConfirmedProfit).toBe(50_000);
    expect(preview.summary.negativeCashMarginCount).toBe(1);
    expect(preview.summary.negativeCashMargin).toBe(-1_000);
    expect(preview.summary.allocationDriftCount).toBe(1);
    expect(preview.summary.noBankEvidenceCount).toBe(1);
    expect(preview.summary.cancelledOrDeletedCount).toBe(1);
    expect(preview.review.map(row => row.reason)).toEqual([
      'no_bank_evidence',
      'allocation_drift',
      'negative_cash_margin',
    ]);
  });
});
