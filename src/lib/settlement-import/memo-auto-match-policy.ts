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
}): boolean {
  if (!input.bookingId) return false;
  if (input.source === 'existing_key' || input.source === 'created_booking') return true;
  return input.source === 'existing_booking' && input.confidence >= 0.85;
}
