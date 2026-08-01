import { describe, expect, it } from 'vitest';
import { calculatePaymentKpis } from './payment-kpi';

describe('calculatePaymentKpis', () => {
  it('separates unpriced cash and calculates outstanding per booking', () => {
    const result = calculatePaymentKpis([
      { total_price: 1_000_000, total_cost: 700_000, paid_amount: 800_000, total_paid_out: 500_000 },
      { total_price: 500_000, total_cost: 300_000, paid_amount: 700_000, total_paid_out: 250_000 },
      { total_price: 0, total_cost: 0, paid_amount: 900_000, total_paid_out: 0 },
    ]);

    expect(result).toEqual({
      totalPrice: 1_500_000,
      totalCost: 1_000_000,
      totalPaid: 2_400_000,
      totalPaidOut: 750_000,
      pricedPaid: 1_300_000,
      unpricedPaid: 900_000,
      unpricedBookingCount: 1,
      uncostedSales: 0,
      uncostedBookingCount: 0,
      remaining: 200_000,
      margin: 500_000,
      bookingCount: 3,
    });
  });

  it('normalizes missing and negative financial values to zero', () => {
    expect(calculatePaymentKpis([{
      total_price: -1,
      total_cost: null,
      paid_amount: undefined,
      total_paid_out: -10,
    }])).toEqual({
      totalPrice: 0,
      totalCost: 0,
      totalPaid: 0,
      totalPaidOut: 0,
      pricedPaid: 0,
      unpricedPaid: 0,
      unpricedBookingCount: 0,
      uncostedSales: 0,
      uncostedBookingCount: 0,
      remaining: 0,
      margin: 0,
      bookingCount: 1,
    });
  });

  it('flags priced bookings whose planned cost is missing', () => {
    const result = calculatePaymentKpis([
      { total_price: 2_000_000, total_cost: 0, paid_amount: 1_000_000 },
    ]);

    expect(result.uncostedBookingCount).toBe(1);
    expect(result.uncostedSales).toBe(2_000_000);
  });
});
