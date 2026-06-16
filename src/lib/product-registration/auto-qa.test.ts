import { describe, expect, it } from 'vitest';
import type { StandardProductRegistrationObject } from './types';
import { runMicroAutoQA } from './auto-qa';

function registration(overrides: Partial<StandardProductRegistrationObject> = {}): StandardProductRegistrationObject {
  const base: StandardProductRegistrationObject = {
    identity: {
      title: 'Cebu golf package',
      destination: 'Cebu',
      destinationCode: 'CEB',
      internalCode: 'PUS-ETC-CEB-05-0001',
      departureCode: 'PUS',
      supplierCode: 'ETC',
      durationDays: 5,
      airline: 'LJ',
    },
    pricing: {
      ok: true,
      source: 'deterministic:hotel_column_matrix',
      tiers: [],
      productPrices: [{
        target_date: '2026-07-24',
        day_of_week: null,
        net_price: 859000,
        adult_selling_price: 859000,
        child_price: null,
        note: 'Solea',
      }],
      priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
      minPrice: 859000,
      selectedPriceBasis: 'deterministic:hotel_column_matrix',
      optionalPriceCandidatesExcluded: true,
      failures: [],
    },
    itinerary: {
      itineraryInput: { days: [{ day: 1, schedule: [{ activity: 'Arrival and hotel check-in' }] }] },
      itineraryDataToSave: { days: [{ day: 1, schedule: [{ activity: 'Arrival and hotel check-in' }] }] },
      scheduleItemCount: 1,
      matchedScheduleItemCount: 0,
      unmatchedCandidateCount: 0,
      unmatchedCandidates: [],
      matchedCanonicalNames: [],
      extractedCandidateRows: [],
      fallbackApplied: false,
      fallbackAirline: null,
      removedPollutedScheduleItems: [],
      warnings: [],
    },
    destination: {
      destination: 'Cebu',
      source: 'existing',
      departureRaw: 'Busan',
      departureCode: 'PUS',
      departureRegion: 'Busan',
      destinationCode: 'CEB',
      durationDays: 5,
      failures: [],
    },
    renderInput: null,
    extractedData: {
      title: 'Cebu golf package',
      destination: 'Cebu',
      duration: 5,
      price: 859000,
      inclusions: ['airfare'],
      excludes: ['personal expenses'],
      rawText: 'Cebu golf package raw',
      price_tiers: [],
    },
    sanitization: { leakScore: 0, incidents: [] },
    priceRecovery: {
      ok: true,
      source: 'deterministic:hotel_column_matrix',
      tiers: [],
      priceRows: [],
      priceDates: [],
      minPrice: 859000,
      failures: [],
    },
    deliverability: { ok: true, blockers: [] },
    evidence: {
      rawTextLength: 21,
      rawTextHash: '0'.repeat(64),
      priceSource: 'deterministic:hotel_column_matrix',
      v3DraftStatus: null,
      v3RawTextHash: null,
      spans: [],
    },
    confidence: 1,
    failures: [],
    warnings: [],
    publishable: true,
  };
  return { ...base, ...overrides };
}

describe('runMicroAutoQA', () => {
  it('passes a clean publishable registration and still records the full three-step verification ledger', () => {
    const result = runMicroAutoQA({
      uploadId: 'upload-1',
      rawText: 'Cebu golf package raw with price 859,000',
      registration: registration(),
      trustScore: 100,
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('PASS');
    expect(result.triggers).toHaveLength(0);
    expect(result.attempts).toHaveLength(4);
    expect(result.attempts.map(event => event.attemptPhase)).toEqual([
      'normal_registration',
      'deterministic_source_recompare',
      'render_payload_audit_repair',
      'final_reregistration_deliverability_audit',
    ]);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      uploadId: 'upload-1',
      attemptNo: 0,
      finalStatus: 'PASS',
      fixtureCandidate: false,
    }));
    expect(result.attempts.every(event => event.finalStatus === 'PASS')).toBe(true);
    expect(result.attempts.every(event => event.autoFixesApplied.length === 0)).toBe(true);
  });

  it('caps automatic improvement at three repair attempts after the normal attempt', () => {
    const result = runMicroAutoQA({
      rawText: 'Cebu golf package raw with price 859,000',
      registration: registration({
        itinerary: {
          ...registration().itinerary,
          removedPollutedScheduleItems: [{ day: 1, activity: 'LJ001', reason: 'flight code only' }],
        },
      }),
      trustScore: 100,
      maxAttempts: 9,
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('AUTO_FIXED');
    expect(result.triggers).toContain('schedule_pollution_removed');
    expect(result.attempts).toHaveLength(4);
    expect(result.attempts.map(event => event.attemptPhase)).toEqual([
      'normal_registration',
      'deterministic_source_recompare',
      'render_payload_audit_repair',
      'final_reregistration_deliverability_audit',
    ]);
    expect(result.recommendedFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'itinerary_data.days[].schedule', kind: 'deterministic' }),
    ]));
    expect(result.attempts[1]?.ruleCandidate).toBe(true);
    expect(result.attempts[2]?.autoFixesApplied).toEqual([]);
    expect(result.attempts[3]?.autoFixesApplied).toEqual([]);
  });

  it('applies deterministic customer selling price repair before final render audit', () => {
    const result = runMicroAutoQA({
      rawText: 'Cebu golf package raw with price 859,000',
      registration: registration({
        pricing: {
          ...registration().pricing,
          productPrices: [{
            target_date: '2026-07-24',
            day_of_week: null,
            net_price: 859000,
            adult_selling_price: null,
            child_price: null,
            note: 'Solea',
          }],
        },
        priceRecovery: {
          ...registration().priceRecovery,
          priceRows: [{
            target_date: '2026-07-24',
            day_of_week: null,
            net_price: 859000,
            adult_selling_price: null,
            child_price: null,
            note: 'Solea',
          }],
          priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
        },
        deliverability: {
          ok: false,
          blockers: ['customer selling price missing: adult_selling_price missing for positive product_prices row 2026-07-24 net 859,000 KRW'],
        },
        publishable: false,
      }),
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('AUTO_FIXED');
    expect(result.repairedRegistration.deliverability.ok).toBe(true);
    expect(result.repairedRegistration.pricing.productPrices[0]?.adult_selling_price).toBe(859000);
    expect(result.attempts[1]?.autoFixesApplied).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'product_prices.adult_selling_price', kind: 'deterministic' }),
    ]));
    expect(result.attempts[2]?.autoFixesApplied).toEqual([]);
    expect(result.attempts[3]?.autoFixesApplied).toEqual([]);
  });

  it('rebuilds price_dates from product_prices date-level minimum', () => {
    const result = runMicroAutoQA({
      rawText: 'Cebu golf package raw with price 859,000 and 899,000',
      registration: registration({
        pricing: {
          ...registration().pricing,
          productPrices: [
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 899000,
              adult_selling_price: 899000,
              child_price: null,
              note: 'Premium',
            },
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 859000,
              adult_selling_price: 859000,
              child_price: null,
              note: 'Standard',
            },
          ],
          priceDates: [{ date: '2026-07-24', price: 899000, confirmed: false }],
        },
        priceRecovery: {
          ...registration().priceRecovery,
          priceRows: [
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 899000,
              adult_selling_price: 899000,
              child_price: null,
              note: 'Premium',
            },
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 859000,
              adult_selling_price: 859000,
              child_price: null,
              note: 'Standard',
            },
          ],
          priceDates: [{ date: '2026-07-24', price: 899000, confirmed: false }],
        },
        deliverability: {
          ok: false,
          blockers: ['price storage mismatch: price storage mismatch 2026-07-24: product_prices min 859,000 != price_dates 899,000'],
        },
        publishable: false,
      }),
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('AUTO_FIXED');
    expect(result.repairedRegistration.pricing.priceDates).toEqual([
      { date: '2026-07-24', price: 859000, confirmed: false },
    ]);
    expect(result.repairedRegistration.extractedData.price).toBe(859000);
    expect(result.attempts[1]?.autoFixesApplied).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'price_dates', kind: 'deterministic' }),
    ]));
  });

  it('rebuilds price_dates when product_prices contain dates missing from the calendar summary', () => {
    const result = runMicroAutoQA({
      rawText: 'Cebu golf package raw with price rows on 2026-07-24 and 2026-07-25',
      registration: registration({
        pricing: {
          ...registration().pricing,
          productPrices: [
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 859000,
              adult_selling_price: 859000,
              child_price: null,
              note: 'Standard',
            },
            {
              target_date: '2026-07-25',
              day_of_week: null,
              net_price: 879000,
              adult_selling_price: 879000,
              child_price: null,
              note: 'Weekend',
            },
          ],
          priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
        },
        priceRecovery: {
          ...registration().priceRecovery,
          priceRows: [
            {
              target_date: '2026-07-24',
              day_of_week: null,
              net_price: 859000,
              adult_selling_price: 859000,
              child_price: null,
              note: 'Standard',
            },
            {
              target_date: '2026-07-25',
              day_of_week: null,
              net_price: 879000,
              adult_selling_price: 879000,
              child_price: null,
              note: 'Weekend',
            },
          ],
          priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
        },
        deliverability: {
          ok: false,
          blockers: ['price storage mismatch: price_dates missing date 2026-07-25'],
        },
        publishable: false,
      }),
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('AUTO_FIXED');
    expect(result.triggers).toContain('price_storage_mismatch');
    expect(result.repairedRegistration.pricing.priceDates).toEqual([
      { date: '2026-07-24', price: 859000, confirmed: false },
      { date: '2026-07-25', price: 879000, confirmed: false },
    ]);
  });
});
