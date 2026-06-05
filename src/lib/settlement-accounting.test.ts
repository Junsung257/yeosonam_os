import { describe, expect, it } from 'vitest';
import { calcSettlementAccounting, sumSettlementAccounting } from './settlement-accounting';

describe('settlement accounting', () => {
  it('calculates owner-facing payment, receivable, profit, tax, and net profit', () => {
    const result = calcSettlementAccounting({
      totalPrice: 400_000,
      totalCost: 360_000,
      paidAmount: 200_000,
      totalPaidOut: 0,
      taxRate: 0,
    });

    expect(result.receivable).toBe(200_000);
    expect(result.grossProfit).toBe(40_000);
    expect(result.netProfit).toBe(40_000);
    expect(result.cashProfit).toBe(200_000);
  });

  it('deducts estimated tax from gross profit', () => {
    const result = calcSettlementAccounting({
      totalPrice: 400_000,
      totalCost: 360_000,
      paidAmount: 400_000,
      totalPaidOut: 360_000,
    });

    expect(result.grossProfit).toBe(40_000);
    expect(result.taxEstimate).toBe(4_000);
    expect(result.netProfit).toBe(36_000);
  });

  it('does not turn overpaid customer or supplier balances negative', () => {
    const result = calcSettlementAccounting({
      totalPrice: 400_000,
      totalCost: 360_000,
      paidAmount: 450_000,
      totalPaidOut: 400_000,
    });

    expect(result.receivable).toBe(0);
    expect(result.payable).toBe(0);
    expect(result.cashProfit).toBe(50_000);
  });

  it('sums booking rows before calculating summary balances', () => {
    const result = sumSettlementAccounting([
      { totalPrice: 400_000, totalCost: 360_000, paidAmount: 200_000, totalPaidOut: 100_000 },
      { totalPrice: 200_000, totalCost: 150_000, paidAmount: 200_000, totalPaidOut: 150_000 },
    ]);

    expect(result.totalPrice).toBe(600_000);
    expect(result.receivable).toBe(200_000);
    expect(result.payable).toBe(260_000);
    expect(result.grossProfit).toBe(90_000);
  });
});
