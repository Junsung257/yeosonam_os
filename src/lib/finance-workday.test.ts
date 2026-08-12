import { describe, expect, it } from 'vitest';

import type { FinanceCenterSummary } from '@/lib/finance-center-service';
import type { FinanceBookingReviewRow } from '@/lib/finance-settlement-v3-service';
import { buildFinanceWorkday } from '@/lib/finance-workday';

const summary: FinanceCenterSummary = {
  generatedAt: '2026-08-12T00:00:00.000Z',
  accountNumber: '100038454128',
  status: {
    connected: true,
    lastSyncAt: '2026-08-12T00:00:00.000Z',
    lastSyncStatus: 'success',
    sourceCount: 482,
    recognizedCount: 482,
    ledgerCount: 482,
    bankBalance: 24_060_610,
    osBalance: 24_060_610,
    difference: 0,
    balanceAsOf: '2026-08-12T00:00:00.000Z',
  },
  metrics: {
    actualBankBalance: 24_060_610,
    protectedTravelCash: 10_000_000,
    protectedCustomerFunds: 8_000_000,
    unpaidSupplierCost: 2_000_000,
    estimatedTaxLiability: 1_000_000,
    estimatedTaxReserve: 500_000,
    actualTaxPayments: 500_000,
    companyOperatingResult: -2_000_000,
    confirmedTravelProfit: 12_000_000,
    afterTaxConfirmedProfit: 10_800_000,
    safeToWithdraw: 8_000_000,
    calculationStatus: 'clear',
    blockers: [],
  },
  actions: {
    travelMemoOrAllocation: 0,
    unmatchedTravel: 0,
    negativeMargin: 1,
    unclassifiedCompany: 3,
    monthCloseWaiting: 1,
    postCloseChanges: 0,
  },
  monthly: [],
  bookings: [],
};

function booking(overrides: Partial<FinanceBookingReviewRow> = {}): FinanceBookingReviewRow {
  return {
    id: 'booking-1',
    bookingNo: 'BK-0001',
    customerName: '고객',
    packageTitle: null,
    departureDate: '2026-07-01',
    bookingStatus: 'confirmed',
    financeExcluded: false,
    financeExclusionReason: null,
    travelKey: '260701_고객_투어폰',
    transactionMemos: [],
    totalPrice: 1_000_000,
    totalCost: 900_000,
    deposits: 1_000_000,
    travelWithdrawals: 900_000,
    customerRefunds: 0,
    bankFees: 0,
    cashMargin: 100_000,
    transactionCount: 2,
    reviewStatus: 'pending',
    reviewFingerprint: 'v4:abc',
    storedReviewFingerprint: null,
    hasReviewDrift: false,
    decisionReason: null,
    assignedTo: null,
    dueDate: null,
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe('buildFinanceWorkday', () => {
  it('prioritizes negative-margin booking before normal booking review', () => {
    const result = buildFinanceWorkday({
      summary,
      pendingBookings: [booking(), booking({ id: 'risk', bookingNo: 'BK-0002', cashMargin: -500 })],
      missingReceiptCount: 2,
      closeMonth: '2026-07',
      now: new Date('2026-08-12T01:00:00.000Z'),
    });

    expect(result.nextTask?.kind).toBe('booking_risk');
    expect(result.nextTask?.href).toContain('focus=risk');
    expect(result.tasks.find(item => item.kind === 'month_close')?.status).toBe('blocked');
    expect(result.metrics.actualBankBalance).toBe(24_060_610);
  });

  it('blocks downstream work when the bank does not reconcile', () => {
    const result = buildFinanceWorkday({
      summary: { ...summary, status: { ...summary.status, difference: 500 } },
      pendingBookings: [],
      missingReceiptCount: 0,
      closeMonth: '2026-07',
      now: new Date('2026-08-12T01:00:00.000Z'),
    });

    expect(result.nextTask?.kind).toBe('sync');
    expect(result.tasks.find(item => item.kind === 'company_classification')?.status).toBe('blocked');
  });

  it('marks every step complete when no work remains', () => {
    const result = buildFinanceWorkday({
      summary: { ...summary, actions: { travelMemoOrAllocation: 0, unmatchedTravel: 0, negativeMargin: 0, unclassifiedCompany: 0, monthCloseWaiting: 0, postCloseChanges: 0 } },
      pendingBookings: [],
      missingReceiptCount: 0,
      closeMonth: '2026-07',
      now: new Date('2026-08-12T01:00:00.000Z'),
    });

    expect(result.nextTask).toBeNull();
    expect(result.completedSteps).toBe(result.totalSteps);
  });
});
