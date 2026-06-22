import { describe, expect, it } from 'vitest';

import { evaluateCustomerDeliveryReadiness } from './customer-delivery-check';

describe('evaluateCustomerDeliveryReadiness partial intake evidence', () => {
  it('fills missing required evidence fields from package fallback evidence', () => {
    const pkg = {
      audit_status: 'clean',
      audit_report: {},
      title: 'Shizuoka 2N3D',
      destination: 'Shizuoka',
      trip_style: '2N3D',
      duration: 3,
      nights: 2,
      departure_airport: 'PUS',
      airline: 'BX',
      min_participants: 10,
      price_tiers: [{ period_label: 'base', adult_price: 749000, status: 'available' }],
      itinerary_data: {
        meta: { flight_out: 'BX1645', flight_in: 'BX1635', departure_airport: 'PUS' },
        days: [],
      },
      raw_text: 'Shizuoka 2 N 3 D 10 BX BX1645 BX1635 749,000',
    };

    const result = evaluateCustomerDeliveryReadiness({
      pkg,
      sourceEvidence: {
        'meta.region': [{ rawTextHash: 'h', start: 0, end: 8, quote: 'Shizuoka', confidence: 1, source: 'manual' }],
      },
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.sourceEvidenceOrigin).toBe('intake');
    expect(result.sourceEvidenceCoverage.missing).toEqual([]);
    expect(result.publishGate.decision).toBe('allow');
  });

  it('does not require full flight-number evidence when only an airline code is customer-visible', () => {
    const result = evaluateCustomerDeliveryReadiness({
      pkg: {
        audit_status: 'clean',
        audit_report: {},
        title: 'PKG ZE Phu Quoc golf 4N6D',
        destination: 'Phu Quoc',
        duration: 6,
        nights: 4,
        airline: 'ZE',
        min_participants: 2,
        price: 1319000,
        price_dates: [{ date: '2027-03-06', price: 1319000, confirmed: false }],
        itinerary_data: {
          meta: { airline: 'ZE' },
          days: [],
        },
        raw_text: 'PKG ZE Phu Quoc golf 4N6D 2 people 3/1~3/31 Saturday 1,319,-',
      } as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: {
        'meta.region': [{ rawTextHash: 'h', start: 7, end: 15, quote: 'Phu Quoc', confidence: 1, source: 'manual' }],
        'meta.tripStyle': [{ rawTextHash: 'h', start: 21, end: 25, quote: '4N6D', confidence: 1, source: 'manual' }],
        'meta.minParticipants': [{ rawTextHash: 'h', start: 26, end: 27, quote: '2', confidence: 1, source: 'manual' }],
        'meta.airline': [{ rawTextHash: 'h', start: 4, end: 6, quote: 'ZE', confidence: 1, source: 'manual' }],
      },
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.sourceEvidenceCoverage.missing).toEqual([]);
    expect(result.publishGate.decision).toBe('allow');
  });
});
