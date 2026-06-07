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
  it('passes a clean publishable registration and records one ledger event', () => {
    const result = runMicroAutoQA({
      uploadId: 'upload-1',
      rawText: 'Cebu golf package raw with price 859,000',
      registration: registration(),
      trustScore: 100,
      createdAt: '2026-06-07T00:00:00.000Z',
    });

    expect(result.status).toBe('PASS');
    expect(result.triggers).toHaveLength(0);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      uploadId: 'upload-1',
      attemptNo: 0,
      finalStatus: 'PASS',
      fixtureCandidate: false,
    }));
  });

  it('caps automatic improvement at three attempts and records deterministic repair candidates', () => {
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
    expect(result.attempts).toHaveLength(3);
    expect(result.recommendedFixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'itinerary_data.days[].schedule', kind: 'deterministic' }),
    ]));
    expect(result.attempts[1]?.ruleCandidate).toBe(true);
  });
});
