export interface SettlementAccountingInput {
  totalPrice?: number | null;
  totalCost?: number | null;
  paidAmount?: number | null;
  totalPaidOut?: number | null;
  taxRate?: number;
}

export interface SettlementAccountingSummary {
  totalPrice: number;
  totalCost: number;
  paidAmount: number;
  totalPaidOut: number;
  receivable: number;
  payable: number;
  cashProfit: number;
  grossProfit: number;
  taxEstimate: number;
  netProfit: number;
}

function money(value: number | null | undefined): number {
  return Math.round(Number(value || 0));
}

export function calcSettlementAccounting(input: SettlementAccountingInput): SettlementAccountingSummary {
  const totalPrice = money(input.totalPrice);
  const totalCost = money(input.totalCost);
  const paidAmount = money(input.paidAmount);
  const totalPaidOut = money(input.totalPaidOut);
  const grossProfit = totalPrice - totalCost;
  const taxRate = input.taxRate ?? 0.1;
  const taxEstimate = Math.max(0, Math.round(grossProfit * taxRate));

  return {
    totalPrice,
    totalCost,
    paidAmount,
    totalPaidOut,
    receivable: Math.max(0, totalPrice - paidAmount),
    payable: Math.max(0, totalCost - totalPaidOut),
    cashProfit: paidAmount - totalPaidOut,
    grossProfit,
    taxEstimate,
    netProfit: grossProfit - taxEstimate,
  };
}

export function sumSettlementAccounting(rows: SettlementAccountingInput[]): SettlementAccountingSummary {
  return calcSettlementAccounting({
    totalPrice: rows.reduce((sum, row) => sum + money(row.totalPrice), 0),
    totalCost: rows.reduce((sum, row) => sum + money(row.totalCost), 0),
    paidAmount: rows.reduce((sum, row) => sum + money(row.paidAmount), 0),
    totalPaidOut: rows.reduce((sum, row) => sum + money(row.totalPaidOut), 0),
  });
}
