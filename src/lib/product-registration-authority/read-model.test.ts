import { describe, expect, it } from 'vitest';

import {
  getPublishedDepartureFact,
  getPublishedProductFacts,
  toJarvisPublishedPackage,
} from './read-model';

const factRow = {
  product_id: 'catalog-1',
  package_id: 'package-1',
  revision_id: 'revision-1',
  snapshot_id: 'snapshot-1',
  snapshot_hash: 'a'.repeat(64),
  pointer_version: 4,
  card_projection: { title: '아티타야 골프', destination: '방콕' },
  lp_projection: { duration: 5, itinerary: [] },
  departure_instances: [
    { departure_date: '2026-10-30', adult_selling_price: 869000, currency: 'KRW', pricing_state: 'PRICED', booking_state: 'MANUAL_CONFIRMATION_REQUIRED' },
    { departure_date: '2026-10-31', adult_selling_price: null, currency: 'KRW', pricing_state: 'CONFLICTING', booking_state: 'MANUAL_CONFIRMATION_REQUIRED', raw_amount: '85,9000' },
  ],
  entity_relations: [{ entity_type: 'golf_course', match_state: 'APPROVED' }],
};

function fakeSupabase() {
  const query = {
    eq: () => query,
    limit: async () => ({ data: [factRow], error: null }),
  };
  return { from: () => ({ select: () => query }) } as never;
}

describe('V6.1 authority read model', () => {
  it('reads pointer-bound facts and preserves conflicting dates', async () => {
    const facts = await getPublishedProductFacts({ supabase: fakeSupabase(), destination: '방콕' });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.browserProofs).toEqual([]);
    expect(getPublishedDepartureFact(facts[0]!, '2026-10-30')?.booking_state).toBe('MANUAL_CONFIRMATION_REQUIRED');
    expect(getPublishedDepartureFact(facts[0]!, '2026-10-31')?.pricing_state).toBe('CONFLICTING');
  });

  it('adapts only typed customer prices and never emits legacy price fallback fields', async () => {
    const fact = (await getPublishedProductFacts({ supabase: fakeSupabase() }))[0]!;
    const pkg = toJarvisPublishedPackage(fact);
    expect(pkg.price_dates).toEqual([expect.objectContaining({ date: '2026-10-30', price: 869000 })]);
    expect(pkg).not.toHaveProperty('net_price');
    expect(pkg).not.toHaveProperty('price_tiers');
    expect(pkg).not.toHaveProperty('excluded_dates');
  });
});
