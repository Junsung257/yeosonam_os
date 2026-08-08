import { describe, expect, it } from 'vitest';
import {
  calculateLedgerSettlement,
  resolveSettlementPeriodKst,
  type LedgerEntryForSettlement,
} from '@/lib/affiliate/settlement-v2';

function earned(id: string, bookingId: string, amountKrw: number, eligibleAt: string): LedgerEntryForSettlement {
  return { id, bookingId, amountKrw, eligibleAt, entryType: 'EARNED' };
}

describe('settlement ledger V2 reference model', () => {
  it('uses Asia/Seoul month boundaries expressed as UTC', () => {
    expect(resolveSettlementPeriodKst('2026-08')).toEqual({
      period: '2026-08',
      startUtc: '2026-07-31T15:00:00.000Z',
      endUtc: '2026-08-31T15:00:00.000Z',
    });
    expect(resolveSettlementPeriodKst('2026-13')).toBeNull();
  });

  it('pays a prior unpaid ledger balance once and leaves zero for the next run', () => {
    const entries = [
      earned('prior-30', 'b1', 30_000, '2026-07-01T00:00:00.000Z'),
      earned('current-100', 'b2', 100_000, '2026-08-10T00:00:00.000Z'),
    ];
    const august = calculateLedgerSettlement({
      entries,
      settledEntryIds: new Set(),
      periodEndUtc: '2026-08-31T15:00:00.000Z',
      minPayoutKrw: 100_000,
      minBookingCount: 2,
      taxRate: 0,
    });
    expect(august).toMatchObject({ qualified: true, netPayoutKrw: 130_000 });
    const september = calculateLedgerSettlement({
      entries,
      settledEntryIds: new Set(august.frozenEntryIds),
      periodEndUtc: '2026-09-30T15:00:00.000Z',
      minPayoutKrw: 100_000,
      minBookingCount: 2,
      taxRate: 0,
    });
    expect(september).toMatchObject({ qualified: false, unsettledTotalKrw: 0, netPayoutKrw: 0 });
  });

  it('keeps monthly entries unsettled until the cumulative booking threshold is met', () => {
    const entries = [
      earned('m1', 'b1', 50_000, '2026-06-10T00:00:00.000Z'),
      earned('m2', 'b2', 50_000, '2026-07-10T00:00:00.000Z'),
      earned('m3', 'b3', 50_000, '2026-08-10T00:00:00.000Z'),
    ];
    const july = calculateLedgerSettlement({
      entries,
      settledEntryIds: new Set(),
      periodEndUtc: '2026-07-31T15:00:00.000Z',
      minPayoutKrw: 100_000,
      minBookingCount: 3,
      taxRate: 0,
    });
    expect(july).toMatchObject({ qualified: false, qualifiedBookingCount: 2, unsettledTotalKrw: 100_000 });
    expect(july.frozenEntryIds).toEqual([]);
    const august = calculateLedgerSettlement({
      entries,
      settledEntryIds: new Set(),
      periodEndUtc: '2026-08-31T15:00:00.000Z',
      minPayoutKrw: 100_000,
      minBookingCount: 3,
      taxRate: 0,
    });
    expect(august).toMatchObject({ qualified: true, qualifiedBookingCount: 3, netPayoutKrw: 150_000 });
  });

  it('applies a post-payout reversal as a new negative line without changing prior lines', () => {
    const entries: LedgerEntryForSettlement[] = [
      earned('earned', 'b1', 100_000, '2026-08-10T00:00:00.000Z'),
      {
        id: 'reversal', bookingId: 'b1', amountKrw: -100_000,
        eligibleAt: '2026-09-02T00:00:00.000Z', entryType: 'REVERSAL',
      },
    ];
    const september = calculateLedgerSettlement({
      entries,
      settledEntryIds: new Set(['earned']),
      periodEndUtc: '2026-09-30T15:00:00.000Z',
      minPayoutKrw: 0,
      minBookingCount: 0,
      taxRate: 0,
    });
    expect(september).toMatchObject({ adjustmentKrw: -100_000, unsettledTotalKrw: -100_000, qualified: false });
    expect(september.frozenEntryIds).toEqual([]);
  });
});
