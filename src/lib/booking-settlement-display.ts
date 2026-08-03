export function getBookingReceivable(
  totalPrice: number | null | undefined,
  paidAmount: number | null | undefined,
): number | null {
  const price = Number(totalPrice) || 0;
  if (price <= 0) return null;
  return Math.max(0, price - (Number(paidAmount) || 0));
}
