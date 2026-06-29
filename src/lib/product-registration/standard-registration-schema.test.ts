import { describe, expect, it } from 'vitest';
import type { StandardProductRegistrationObject } from './types';
import {
  StandardProductRegistrationJsonSchema,
  validateStandardProductRegistrationObject,
} from './standard-registration-schema';

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
      source: 'deterministic:fixture',
      tiers: [],
      productPrices: [{
        target_date: '2026-07-24',
        day_of_week: null,
        net_price: 859000,
        adult_selling_price: 859000,
        child_price: null,
        note: null,
      }],
      priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
      minPrice: 859000,
      selectedPriceBasis: 'deterministic:fixture',
      optionalPriceCandidatesExcluded: true,
      failures: [],
    },
    itinerary: {
      itineraryInput: { days: [{ day: 1, schedule: [] }] },
      itineraryDataToSave: { days: [{ day: 1, schedule: [] }] },
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
      rawText: 'Cebu golf package raw',
      price_tiers: [],
    },
    sanitization: { leakScore: 0, incidents: [] },
    priceRecovery: {
      ok: true,
      source: 'deterministic:fixture',
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
      priceSource: 'deterministic:fixture',
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

describe('validateStandardProductRegistrationObject', () => {
  it('exports a JSON Schema contract for structured-output and eval tooling', () => {
    expect(StandardProductRegistrationJsonSchema).toMatchObject({
      $ref: '#/definitions/StandardProductRegistrationObject',
      definitions: {
        StandardProductRegistrationObject: {
          type: 'object',
          required: expect.arrayContaining(['extractedData', 'pricing', 'itinerary', 'deliverability', 'evidence']),
        },
      },
    });
  });

  it('accepts a customer-deliverable registration with prices, dates, itinerary, and source hash', () => {
    expect(validateStandardProductRegistrationObject(registration()).ok).toBe(true);
  });

  it('blocks deliverable registrations that lost price rows before persistence', () => {
    const result = validateStandardProductRegistrationObject(registration({
      pricing: {
        ...registration().pricing,
        productPrices: [],
      },
    }));

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('product_prices');
  });

  it('blocks evidence spans that no longer point at the same raw source hash', () => {
    const result = validateStandardProductRegistrationObject(registration({
      evidence: {
        ...registration().evidence,
        spans: [{
          field: 'title',
          rawTextHash: '1'.repeat(64),
          start: 0,
          end: 4,
          quote: 'Cebu',
          confidence: 0.9,
        }],
      },
    }));

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('evidence span hash mismatch');
  });

  it('accepts EvidenceV2 spans that point at a registered source document hash', () => {
    const documentHash = '1'.repeat(64);
    const result = validateStandardProductRegistrationObject(registration({
      evidence: {
        ...registration().evidence,
        sourceDocuments: [
          {
            sourceId: 'original_raw',
            rawTextHash: '0'.repeat(64),
            rawTextLength: 21,
            role: 'original',
          },
          {
            sourceId: 'document_raw',
            rawTextHash: documentHash,
            rawTextLength: 100,
            role: 'document',
          },
        ],
        spans: [{
          field: 'pricing.productPrices[0].adult_selling_price',
          rawTextHash: documentHash,
          sourceId: 'document_raw',
          start: 10,
          end: 17,
          quote: '859,000',
          confidence: 0.9,
        }],
      },
    }));

    expect(result.ok).toBe(true);
  });
});
