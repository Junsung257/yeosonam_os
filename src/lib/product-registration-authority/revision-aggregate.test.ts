import { describe, expect, it } from 'vitest';

import {
  buildPackageProjectionFromRevision,
  productRegistrationRevisionProjectionBlocker,
  type ProductRegistrationRevisionAggregate,
} from './revision-aggregate';

function aggregate(): ProductRegistrationRevisionAggregate {
  return {
    revision: {
      id: 'revision-1',
      tenant_id: 'tenant-1',
      catalog_product_id: 'catalog-1',
      payload_hash: 'a'.repeat(64),
      source_hash: 'b'.repeat(64),
      revision_no: 2,
      canonical_payload: {
        sections: [{ destinationHint: '다낭', v3: { ledger: {
          document: { type: 'single_product', expected_products: 1, variant_axes: [] },
          variants: [{
            variant_key: 'danang-1',
            grade: null,
            course: null,
            duration_days: 5,
            nights: 3,
            title_parts: ['부산 출발 다낭 3박5일'],
            price_calendar: [{ date: '2026-10-01', label: '10/1', amount: 999000, currency: 'KRW', evidence: {} }],
            flight_segments: [{ leg: 'outbound', code: 'BX321', dep_time: '19:00', arr_time: '22:00', evidence: {} }],
            days: [{
              day: 1,
              route: ['다낭'],
              events: [],
              meals: { breakfast: {}, lunch: {}, dinner: {} },
              hotel: { raw_text: '다낭 시내 동급 호텔' },
            }],
            inclusions: [{ value: '왕복 항공료', evidence: {} }],
            exclusions: [{ value: '가이드 경비', evidence: {} }],
            options: [],
            shopping: [],
            structured_facts: [],
            standard_notices: [],
            minimum_departure: null,
            evidence_coverage: {},
          }],
        } } }],
      },
    },
    departures: [],
    transportSegments: [],
    lodgingStays: [],
    golfRounds: [],
    terms: [],
    media: [],
  };
}

describe('revision aggregate package projection', () => {
  it('builds customer facts from canonical revision without a legacy package payload', () => {
    const pkg = buildPackageProjectionFromRevision({ packageId: 'package-1', aggregate: aggregate() });
    expect(pkg).toMatchObject({
      id: 'package-1',
      catalog_product_id: 'catalog-1',
      title: '부산 출발 다낭 3박5일',
      destination: '다낭',
      price: 999000,
      duration: 5,
      nights: 3,
      hero_image_url: null,
    });
  });

  it('uses the source-backed canonical destination instead of an airport-code route cell', () => {
    const input = aggregate();
    const section = (input.revision.canonical_payload.sections as Array<Record<string, any>>)[0];
    section.v3.ledger.variants[0].days[0].route = ['PUS', 'DAD'];
    const pkg = buildPackageProjectionFromRevision({ packageId: 'package-1', aggregate: input });
    expect(pkg.destination).toBe('다낭');
  });

  it('fails closed when one revision ambiguously contains multiple variants', () => {
    const input = aggregate();
    const section = (input.revision.canonical_payload.sections as Array<Record<string, any>>)[0];
    section.v3.ledger.variants.push({ ...section.v3.ledger.variants[0], variant_key: 'danang-2' });
    expect(() => buildPackageProjectionFromRevision({ packageId: 'package-1', aggregate: input }))
      .toThrow('REVISION_VARIANT_CARDINALITY_UNSUPPORTED');
  });

  it('classifies ambiguous projection cardinality as a safe customer block instead of infrastructure failure', () => {
    expect(productRegistrationRevisionProjectionBlocker(
      new Error('REVISION_VARIANT_CARDINALITY_UNSUPPORTED'),
    )).toBe('REVISION_VARIANT_CARDINALITY_UNSUPPORTED');
    expect(productRegistrationRevisionProjectionBlocker(new Error('DATABASE_UNAVAILABLE'))).toBeNull();
  });
});
