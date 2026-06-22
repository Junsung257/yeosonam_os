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
});
