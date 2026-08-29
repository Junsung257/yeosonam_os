import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV6DomainProjection } from '../domain-projections';
import { atitayaSourceFixture } from './atitaya-source-fixture';

describe('Atitaya source regression fixture', () => {
  it('is review-required and preserves the supplied blocker inventory', () => {
    expect(atitayaSourceFixture.expectedOutcome).toBe('REVIEW_REQUIRED');
    expect(atitayaSourceFixture.expectedBlockers).toContain('PRICE_FORMAT_AMBIGUOUS');
    expect(atitayaSourceFixture.expectedBlockers).toContain('VARIANT_BOUNDARY_AMBIGUOUS');
    expect(atitayaSourceFixture.rawMarkers).toContain('85,9000');
  });

  it('keeps exact-date special pricing and malformed amounts distinct', () => {
    const projection = buildProductRegistrationV6DomainProjection({
      canonicalPayload: atitayaSourceFixture.canonicalPayload,
    });
    const special = projection.departures.find(row => row.departure_date === '2026-10-30');
    const malformed = projection.departures.find(row => row.departure_date === '2026-10-31');
    expect(special).toMatchObject({
      adult_selling_price: 869000,
      pricing_state: 'PRICED',
      booking_state: 'MANUAL_CONFIRMATION_REQUIRED',
      price_rule_type: 'EXACT_DATE_OVERRIDE',
    });
    expect(malformed).toMatchObject({
      adult_selling_price: null,
      raw_amount: '85,9000',
      pricing_state: 'CONFLICTING',
    });
  });

  it('keeps 3박5일 and unresolved 4박6일 blocks in separate variants', () => {
    const projection = buildProductRegistrationV6DomainProjection({
      canonicalPayload: atitayaSourceFixture.canonicalPayload,
    });
    expect(new Set(projection.lodgingStays.map(row => row.variant_key))).toEqual(new Set(['3n5d']));
    expect(new Set(projection.golfRounds.map(row => row.variant_key))).toEqual(new Set(['3n5d', '4n6d']));
  });
});
