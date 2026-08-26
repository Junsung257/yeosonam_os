export type SettlementMemoResolutionSource =
  | 'existing_key'
  | 'existing_booking'
  | 'created_booking'
  | 'ambiguous'
  | 'error'
  | null
  | undefined;

/**
 * A travel memo is safe for automatic allocation only when it resolves to
 * one booking with strong evidence. Ambiguous or fuzzy resolutions stay in
 * the review queue so a payout cannot be assigned to the wrong trip.
 */
export function canAutoMatchSettlementMemo(input: {
  bookingId?: string | null;
  source: SettlementMemoResolutionSource;
  confidence: number;
  allowCreatedBooking?: boolean;
}): boolean {
  if (!input.bookingId) return false;
  if (input.source === 'existing_key') return true;
  // Clobe canonical memo imports create the settlement booking themselves.
  // Deposits may be posted immediately; the importer only calls this policy
  // for deposits, so payouts remain a review/approval action.
  if (input.source === 'created_booking') return input.allowCreatedBooking === true;
  return input.source === 'existing_booking' && input.confidence >= 0.85;
}
