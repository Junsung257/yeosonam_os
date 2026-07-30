import { describe, expect, it } from 'vitest';
import { GOLDEN_PASTE_E2E_CASES, type GoldenPasteCaseKind } from './paste-e2e-cases';
import { evaluateGoldenPasteE2E } from './paste-e2e-evaluator';

describe('golden paste E2E cases', () => {
  it('pins 15 supplier paste shapes for upload-to-mobile hardening', () => {
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
      'monthly_weekday_price_grid',
      'multiproduct_mixed_catalog',
      'net_gross_margin_lines',
      'ticketing_deadline_soon',
      'local_expense_multi_currency',
    ];

    expect(GOLDEN_PASTE_E2E_CASES).toHaveLength(15);
    expect(new Set(GOLDEN_PASTE_E2E_CASES.map(testCase => testCase.kind))).toEqual(new Set(requiredKinds));
    for (const testCase of GOLDEN_PASTE_E2E_CASES) {
      expect(testCase.rawText.length).toBeGreaterThan(40);
      expect(testCase.expected.packagesProofRequired).toBe(true);
      expect(testCase.expected.lpProofRequired).toBe(true);
      expect(testCase.expected.downstreamEligibilityRequiresCustomerOpenContract).toBe(true);
    }
  });

  it('executes raw-only paste registration without injecting expected fields', async () => {
    const report = await evaluateGoldenPasteE2E(0.95);

    expect(report.passed).toBe(true);
    expect(report.metrics.registration_success_rate).toBe(1);
    expect(report.metrics.field_accuracy_rate).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.incomplete_source_block_rate).toBe(1);
    expect(report.metrics.multiproduct_split_rate).toBe(1);
    expect(report.metrics.inbound_next_day_success_rate).toBe(1);
    expect(report.metrics.option_price_misclassification_rate).toBe(0);
    expect(report.cases.flatMap(testCase => testCase.checks).filter(check => !check.passed)).toEqual([]);
  }, 30_000);
});
