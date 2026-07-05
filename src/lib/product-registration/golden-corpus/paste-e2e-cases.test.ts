import { describe, expect, it } from 'vitest';
import { GOLDEN_PASTE_E2E_CASES, type GoldenPasteCaseKind } from './paste-e2e-cases';
import { registerProductFromRaw } from '../register-product-from-raw';

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

  it('runs the first 10 supplier paste shapes through the registration engine smoke path', async () => {
    for (const testCase of GOLDEN_PASTE_E2E_CASES) {
      const dayCount = testCase.expected.dayCount ?? 1;
      const departureDates = testCase.expected.departureDates.length > 0
        ? testCase.expected.departureDates
        : ['2026-09-01'];
      const adultPrice = testCase.expected.adultPrice ?? 699000;
      const result = await registerProductFromRaw({
        rawText: testCase.rawText,
        originalRawText: testCase.rawText,
        parserRawText: testCase.rawText,
        documentRawText: testCase.rawText,
        analysisNormalizedText: testCase.rawText,
        extractedData: {
          title: testCase.expected.title,
          destination: testCase.expected.destination ?? undefined,
          duration: dayCount,
          rawText: testCase.rawText,
          price_tiers: [{
            period_label: 'golden smoke',
            departure_dates: departureDates,
            adult_price: adultPrice,
            status: 'available',
          }],
        },
        itineraryData: {
          days: Array.from({ length: dayCount }, (_, index) => ({
            day: index + 1,
            regions: [testCase.expected.destination ?? 'Unknown'],
            meals: {},
            schedule: [{ type: 'activity', activity: `${testCase.expected.title} day ${index + 1}` }],
          })),
          ...(testCase.kind === 'inbound_next_day_arrival' ? {
            flight_segments: [
              { leg: 'inbound', flight_no: 'BX782', dep_time: '23:20', arr_time: '06:20', arr_day_offset: 1, day_pair: [dayCount, dayCount] },
            ],
          } : {}),
        },
        title: testCase.expected.title,
        activeAttractions: [],
        destinationCode: 'TST',
        internalCode: `PUS-ETC-TST-${String(dayCount).padStart(2, '0')}-${testCase.id}`,
        enableGeminiFallback: false,
        priceYear: 2026,
      });

      expect(result.identity.title).toContain(testCase.expected.title);
      expect(result.pricing.minPrice).toBe(adultPrice);
      expect((result.itinerary.itineraryDataToSave as { days?: unknown[] } | null)?.days?.length ?? 0)
        .toBe(dayCount);
      expect(result.evidence.sourceDocuments).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: 'section_raw' }),
      ]));
      if (testCase.kind === 'optional_tour_usd' || testCase.kind === 'shopping_option_meal_noise') {
        expect(result.pricing.productPrices.map(row => row.net_price)).not.toContain(30);
        expect(result.pricing.productPrices.map(row => row.net_price)).not.toContain(50);
        expect(result.pricing.excludedPriceCandidates).toEqual(expect.arrayContaining([
          expect.objectContaining({ currency: 'USD', reason: 'optional_tour_candidate' }),
        ]));
      }
      if (testCase.kind === 'inbound_next_day_arrival') {
        const inbound = (result.itinerary.itineraryDataToSave as { flight_segments?: Array<Record<string, unknown>> } | null)
          ?.flight_segments
          ?.find(segment => segment.leg === 'inbound');
        expect(inbound).toMatchObject({ arr_day_offset: 1 });
      }
    }
  }, 30_000);
});
