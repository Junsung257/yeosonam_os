import { describe, expect, it } from 'vitest';
import { hasHandoffContext, readHandoffContext, splitHandoffList } from './handoff-query';

describe('handoff query parsing', () => {
  it('reads canonical handoff fields', () => {
    const params = new URLSearchParams({
      source: 'package_detail',
      intent: 'golf_compare',
      party_type: 'golf_group',
      query: 'Da Nang golf package',
      destination: 'Da Nang',
      budget: '1,000,000 KRW',
      selected_products: 'Package A,Package B',
    });

    expect(readHandoffContext(params)).toEqual({
      source: 'package_detail',
      intent: 'golf_compare',
      partyType: 'golf_group',
      query: 'Da Nang golf package',
      destination: 'Da Nang',
      budget: '1,000,000 KRW',
      selectedProducts: ['Package A', 'Package B'],
    });
  });

  it('accepts common alias field names from external CTAs', () => {
    const params = new URLSearchParams({
      from: 'landing',
      category: 'family',
      partyType: 'family',
      q: 'family resort trip',
      region: 'Cebu',
      budget_label: 'under 900,000 KRW',
      selectedProducts: 'Family Pack|Resort Pack',
    });

    const context = readHandoffContext(params);

    expect(hasHandoffContext(context)).toBe(true);
    expect(context).toMatchObject({
      source: 'landing',
      intent: 'family',
      partyType: 'family',
      query: 'family resort trip',
      destination: 'Cebu',
      budget: 'under 900,000 KRW',
      selectedProducts: ['Family Pack', 'Resort Pack'],
    });
  });

  it('deduplicates and caps selected products', () => {
    expect(splitHandoffList('A,A,B,C,D,E,F,G,H,I')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });
});
