import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRATION_POLICY } from '@/lib/registration-policy';
import type { ProductRegistrationResult } from './types';
import { finalizeUploadRegistration } from './finalize-registration';

function baseRegistration(overrides: Partial<ProductRegistrationResult['extractedData']> = {}): ProductRegistrationResult {
  const extractedData = {
    title: 'Cebu semi package 3 nights 5 days LJ',
    destination: 'Cebu',
    duration: 5,
    price: 859000,
    product_type: 'package',
    inclusions: ['airfare', 'hotel'],
    excludes: ['guide tip'],
    notices_parsed: [],
    price_tiers: [],
    rawText: 'Cebu package fixture',
    ...overrides,
  } as ProductRegistrationResult['extractedData'];

  return {
    identity: {
      title: extractedData.title ?? null,
      destination: extractedData.destination ?? null,
      destinationCode: 'CEB',
      internalCode: 'PUS-ETC-CEB-05-0001',
      departureCode: 'PUS',
      supplierCode: 'ETC',
      durationDays: extractedData.duration ?? null,
      airline: extractedData.airline ?? null,
    },
    pricing: {
      ok: true,
      source: 'test',
      tiers: [],
      productPrices: [],
      priceDates: [],
      minPrice: extractedData.price ?? null,
      selectedPriceBasis: 'test',
      optionalPriceCandidatesExcluded: true,
      failures: [],
    },
    itinerary: {
      itineraryInput: { days: [{ day: 1, schedule: [] }] },
      itineraryDataToSave: { days: [{ day: 1, schedule: [] }] },
      scheduleItemCount: 0,
      matchedScheduleItemCount: 0,
      unmatchedCandidateCount: 0,
      matchedCanonicalNames: [],
      unmatchedCandidates: [],
      extractedCandidateRows: [],
      fallbackApplied: false,
      removedPollutedScheduleItems: [],
      warnings: [],
      fallbackAirline: null,
    },
    destination: {
      destination: extractedData.destination ?? null,
      source: 'existing',
      departureRaw: 'Busan',
      departureCode: 'PUS',
      departureRegion: 'Busan',
      destinationCode: 'CEB',
      durationDays: extractedData.duration ?? 5,
      failures: [],
    },
    renderInput: null,
    extractedData,
    sanitization: { leakScore: 0, incidents: [] },
    priceRecovery: {
      ok: true,
      source: 'test',
      tiers: [],
      priceRows: [],
      priceDates: [],
      minPrice: extractedData.price ?? null,
      failures: [],
    },
    deliverability: { ok: true, blockers: [] },
    evidence: {
      rawTextLength: 20,
      rawTextHash: '0'.repeat(64),
      priceSource: 'test',
      v3DraftStatus: null,
      v3RawTextHash: null,
      spans: [],
    },
    confidence: null,
    failures: [],
    warnings: [],
    publishable: true,
  };
}

describe('finalizeUploadRegistration', () => {
  it('forces review status when finalized upload gate is blocked', () => {
    const registration = baseRegistration({ price: 0 });
    const result = finalizeUploadRegistration({
      registration,
      rawText: 'Cebu package fixture',
      title: registration.extractedData.title ?? 'Untitled',
      netPrice: 1,
      internalCode: 'PUS-ETC-CEB-05-0001',
      policy: DEFAULT_REGISTRATION_POLICY,
      priceRows: [],
      itineraryInput: registration.itinerary.itineraryInput,
      itineraryDataToSave: registration.itinerary.itineraryDataToSave,
      scheduleItemCount: 0,
    });

    expect(result.uploadGate).toBe('BLOCKED');
    expect(result.productStatus).toBe('REVIEW_NEEDED');
    expect(result.pkgStatus).toBe('pending');
  });

  it('builds the write row from the finalized registration data', () => {
    const registration = baseRegistration({ inclusions: ['airfare'], excludes: ['guide tip'] });
    const result = finalizeUploadRegistration({
      registration,
      rawText: 'Cebu package fixture',
      title: registration.extractedData.title ?? 'Untitled',
      netPrice: 859000,
      internalCode: 'PUS-ETC-CEB-05-0001',
      policy: DEFAULT_REGISTRATION_POLICY,
      priceRows: [{
        target_date: '2026-07-24',
        day_of_week: null,
        net_price: 859000,
        adult_selling_price: null,
        child_price: null,
        note: null,
      }],
      itineraryInput: registration.itinerary.itineraryInput,
      itineraryDataToSave: registration.itinerary.itineraryDataToSave,
      scheduleItemCount: 0,
    });

    expect(result.draftRow.inclusions).toContain('airfare');
    expect(result.draftRow.excludes).toContain('guide tip');
    expect(result.confidenceV3).toBeGreaterThan(0);
  });
});
