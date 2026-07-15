import { describe, expect, it } from 'vitest';

import { buildPublicPackageSnapshot } from './public-snapshot';
import { buildFieldEvidenceRecords } from './field-evidence';

describe('buildFieldEvidenceRecords', () => {
  it('records source-backed and approved-derived public fields deterministically', () => {
    const source = {
      id: '11111111-1111-4111-8111-111111111111',
      package_revision: 4,
      title: '연길 백두산 노옵션 4박5일',
      destination: '연길/백두산',
      duration: 5,
      price: 599000,
      price_dates: [{ date: '2026-07-12', price: 599000 }],
      inclusions: ['왕복항공료'],
      excludes: ['개인경비'],
      optional_tours: ['노옵션'],
      itinerary_data: [{ day: 1, title: '연길 도착' }],
      thumbnail_urls: ['https://images.example.com/yanji.jpg'],
    };
    const { snapshot } = buildPublicPackageSnapshot(source);

    const first = buildFieldEvidenceRecords(source, snapshot);
    const second = buildFieldEvidenceRecords(source, snapshot);

    expect(first).toEqual(second);
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_path: 'public_title', evidence_type: 'approved_derivation' }),
      expect.objectContaining({ field_path: 'inclusions_public', evidence_type: 'source_field' }),
      expect.objectContaining({ field_path: 'itinerary_public', evidence_type: 'source_field' }),
    ]));
    expect(first.every(record => /^[a-f0-9]{64}$/.test(record.normalized_value_hash))).toBe(true);
  });

  it('does not certify a source field when the source value is absent', () => {
    const source = {
      id: '11111111-1111-4111-8111-111111111111',
      package_revision: 1,
      title: '다낭 3박5일',
      destination: '다낭',
      duration: 5,
      price: 499000,
      price_dates: [{ date: '2026-08-01', price: 499000 }],
      thumbnail_urls: ['https://images.example.com/danang.jpg'],
    };
    const { snapshot } = buildPublicPackageSnapshot(source);
    const records = buildFieldEvidenceRecords(source, snapshot);

    expect(records.some(record => record.field_path === 'itinerary_public')).toBe(false);
  });
});
