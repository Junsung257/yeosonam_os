export interface PaymentKpiBooking {
  total_price?: number | null;
  total_cost?: number | null;
  paid_amount?: number | null;
  total_paid_out?: number | null;
}

export interface PaymentKpis {
  totalPrice: number;
  totalCost: number;
  totalPaid: number;
  totalPaidOut: number;
  pricedPaid: number;
  unpricedPaid: number;
  unpricedBookingCount: number;
  uncostedSales: number;
  uncostedBookingCount: number;
  remaining: number;
  margin: number;
  bookingCount: number;
}

function amount(value: number | null | undefined): number {
  return Math.max(0, Number(value) || 0);
}

export function calculatePaymentKpis(bookings: PaymentKpiBooking[]): PaymentKpis {
  return bookings.reduce<PaymentKpis>((result, booking) => {
    const price = amount(booking.total_price);
    const cost = amount(booking.total_cost);
    const paid = amount(booking.paid_amount);
    const paidOut = amount(booking.total_paid_out);

    result.totalPrice += price;
    result.totalCost += cost;
    result.totalPaid += paid;
    result.totalPaidOut += paidOut;
    result.margin += price - cost;
    result.bookingCount += 1;

    if (price > 0) {
      result.pricedPaid += Math.min(paid, price);
      result.remaining += Math.max(0, price - paid);
      if (cost <= 0) {
        result.uncostedSales += price;
        result.uncostedBookingCount += 1;
      }
    } else if (paid > 0) {
      result.unpricedPaid += paid;
      result.unpricedBookingCount += 1;
    }

    return result;
  }, {
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
    bookingCount: 0,
  });
}
