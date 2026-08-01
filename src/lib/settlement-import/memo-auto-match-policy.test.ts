import { describe, expect, it } from 'vitest';
import { canAutoMatchSettlementMemo } from './memo-auto-match-policy';

describe('canAutoMatchSettlementMemo', () => {
  it('allows an exact settlement key or a newly created booking', () => {
    expect(canAutoMatchSettlementMemo({ bookingId: 'booking-1', source: 'existing_key', confidence: 1 })).toBe(true);
    expect(canAutoMatchSettlementMemo({ bookingId: 'booking-2', source: 'created_booking', confidence: 1 })).toBe(true);
  });

  it('allows a strong existing-booking resolution', () => {
    expect(canAutoMatchSettlementMemo({ bookingId: 'booking-1', source: 'existing_booking', confidence: 0.85 })).toBe(true);
  });

  it('keeps weak, ambiguous, and missing resolutions in review', () => {
    expect(canAutoMatchSettlementMemo({ bookingId: 'booking-1', source: 'existing_booking', confidence: 0.84 })).toBe(false);
    expect(canAutoMatchSettlementMemo({ bookingId: null, source: 'ambiguous', confidence: 1 })).toBe(false);
    expect(canAutoMatchSettlementMemo({ bookingId: null, source: 'existing_key', confidence: 1 })).toBe(false);
  });
});
