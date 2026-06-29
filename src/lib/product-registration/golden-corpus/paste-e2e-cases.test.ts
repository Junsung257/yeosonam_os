import { describe, expect, it } from 'vitest';
import { GOLDEN_PASTE_E2E_CASES, type GoldenPasteCaseKind } from './paste-e2e-cases';

describe('golden paste E2E cases', () => {
  it('pins the first 10 supplier paste shapes for upload-to-mobile hardening', () => {
    const requiredKinds: GoldenPasteCaseKind[] = [
      'catalog_shared_price_table',
      'optional_tour_usd',
      'inbound_next_day_arrival',
      'multiple_departure_dates',
      'missing_departure_date',
      'hotel_tba',
      'airline_tba',
      'long_inclusions_exclusions',
      'shopping_option_meal_noise',
      'separate_cancellation_policy',
    ];

    expect(GOLDEN_PASTE_E2E_CASES).toHaveLength(10);
    expect(new Set(GOLDEN_PASTE_E2E_CASES.map(testCase => testCase.kind))).toEqual(new Set(requiredKinds));
    for (const testCase of GOLDEN_PASTE_E2E_CASES) {
      expect(testCase.rawText.length).toBeGreaterThan(40);
      expect(testCase.expected.packagesProofRequired).toBe(true);
      expect(testCase.expected.lpProofRequired).toBe(true);
      expect(testCase.expected.downstreamEligibilityRequiresCustomerOpenContract).toBe(true);
    }
  });
});
