import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public package search contract', () => {
  it('uses the public catalog and exposes only customer list fields', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/packages/search/route.ts'), 'utf8');
    expect(source).toContain('listPublicCatalog');
    expect(source).not.toContain(".from('travel_packages')");
    expect(source).not.toContain('snapshotHash');
    expect(source).not.toContain('revisionId');
    expect(source).not.toContain('policy_hash');
    expect(source).not.toContain('canonical_payload_hash');
    for (const key of [
      'id', 'slug', 'productKind', 'title', 'destination', 'departureAirport',
      'duration', 'heroImage', 'priceDisplay', 'availableDates', 'badges',
      'bookingMode', 'lastVerifiedAt',
    ]) {
      expect(source).toContain(`${key}: item.${key}`);
    }
  });
});
