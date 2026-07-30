import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { evaluateOptionalTourSourceEvidence } from './source-evidence-contract';

const region = '\uD0DC\uAD6D';
const tour = '\uB9C8\uC0AC\uC9C0 60\uBD84';

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

describe('optional tour source evidence contract', () => {
  it('accepts a unique source-context region and records immutable evidence', () => {
    const raw = `\uCD94\uCC9C\uC120\uD0DD\uAD00\uAD11: ${region} ${tour} $40/\uC778`;
    const result = evaluateOptionalTourSourceEvidence({
      id: 'pkg-1',
      raw_text: raw,
      raw_text_hash: hash(raw),
      optional_tours: [{ name: tour, price: '$40' }],
      itinerary_data: { days: [{ regions: [region] }] },
    });

    expect(result.status).toBe('pass');
    expect(result.entries[0]).toMatchObject({
      status: 'verified',
      region,
      basis: 'source_context',
      source_hash: hash(raw),
      source_line: 1,
    });
    expect(result.entries[0].quote).toContain(tour);
  });

  it('requires review when only itinerary context can disambiguate', () => {
    const raw = `\uC120\uD0DD\uAD00\uAD11: ${tour} $40/\uC778`;
    const result = evaluateOptionalTourSourceEvidence({
      id: 'pkg-2',
      raw_text: raw,
      raw_text_hash: hash(raw),
      optional_tours: [{ name: tour, price: '$40' }],
      itinerary_data: { days: [{ regions: [region] }] },
    });

    expect(result.status).toBe('review');
    expect(result.review_required).toHaveLength(1);
    expect(result.entries[0].basis).toBe('itinerary_context');
  });

  it('blocks missing source or a stale source hash instead of guessing', () => {
    const missing = evaluateOptionalTourSourceEvidence({
      id: 'pkg-3',
      raw_text: null,
      raw_text_hash: null,
      optional_tours: [{ name: tour, price: '$40' }],
      itinerary_data: null,
    });
    expect(missing.status).toBe('blocked');
    expect(missing.blockers).toContain('optional_tour_source_missing:raw_text');

    const stale = evaluateOptionalTourSourceEvidence({
      id: 'pkg-4',
      raw_text: `\uC120\uD0DD\uAD00\uAD11: ${tour} $40`,
      raw_text_hash: 'stale',
      optional_tours: [{ name: tour, price: '$40' }],
      itinerary_data: null,
    });
    expect(stale.status).toBe('blocked');
    expect(stale.blockers).toContain('optional_tour_source_hash_mismatch');
  });
});
