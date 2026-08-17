import { describe, expect, it } from 'vitest';

import { getExplicitSourceCompareAtPrice } from './map-travel-package-to-lp';

describe('customer landing source discount', () => {
  it('shows only an explicit same-row supplier list-to-final relation', () => {
    expect(getExplicitSourceCompareAtPrice([
      { price: 839_000, price_relation: 'standard_sale' },
      { price: 599_000, list_price: 839_000, price_relation: 'final_sale' },
    ], 599_000)).toBe(839_000);
  });

  it('does not mislabel a different departure date price as a discount list price', () => {
    expect(getExplicitSourceCompareAtPrice([
      { price: 839_000, price_relation: 'standard_sale' },
      { price: 599_000, price_relation: 'standard_sale' },
    ], 599_000)).toBeNull();
  });
});
