import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeConciergeItemForPublic, sanitizeConciergeItemsForPublic } from './concierge-public-payload';

describe('concierge public payload safety', () => {
  it('removes item-level cost and margin fields', () => {
    const sanitized = sanitizeConciergeItemForPublic({
      product_id: 'item-1',
      product_name: 'Customer item',
      api_name: 'tenant_product',
      product_type: 'ACTIVITY',
      product_category: 'FIXED',
      cost: 80_000,
      cost_price: 80_000,
      net_price: 80_000,
      margin: 20_000,
      margin_rate: 0.2,
      selling_price: 100_000,
      price: 100_000,
      attrs: {
        tenant_id: 'tenant-1',
        date: '2026-07-01',
        available_seats: 4,
        margin: 20_000,
        cost_price: 80_000,
      },
    });

    expect(sanitized).toMatchObject({
      product_id: 'item-1',
      product_name: 'Customer item',
      price: 100_000,
      attrs: {
        tenant_id: 'tenant-1',
        date: '2026-07-01',
        available_seats: 4,
      },
    });
    expect(sanitized).not.toHaveProperty('cost');
    expect(sanitized).not.toHaveProperty('cost_price');
    expect(sanitized).not.toHaveProperty('net_price');
    expect(sanitized).not.toHaveProperty('margin');
    expect(sanitized).not.toHaveProperty('margin_rate');
    expect(sanitized).not.toHaveProperty('selling_price');
    expect(sanitized.attrs as Record<string, unknown>).not.toHaveProperty('margin');
    expect(sanitized.attrs as Record<string, unknown>).not.toHaveProperty('cost_price');
  });

  it('sanitizes arrays and ignores invalid items', () => {
    expect(sanitizeConciergeItemsForPublic([
      { product_id: 'item-1', price: 100_000, cost: 80_000 },
      null,
      'bad',
    ])).toEqual([{ product_id: 'item-1', price: 100_000 }]);
  });

  it('uses the sanitizer on concierge search and cart responses', () => {
    const searchRoute = readFileSync(join(process.cwd(), 'src/app/api/concierge/search/route.ts'), 'utf8');
    const cartRoute = readFileSync(join(process.cwd(), 'src/app/api/concierge/cart/route.ts'), 'utf8');

    expect(searchRoute).toContain('sanitizeConciergeItemsForPublic');
    expect(searchRoute).toContain('results: sanitizeConciergeItemsForPublic');
    expect(cartRoute).toContain('sanitizeConciergeItemForPublic');
    expect(cartRoute).toContain('sanitizeConciergeItemsForPublic');
  });

  it('keeps checkout cost and price server-authoritative', () => {
    const checkoutRoute = readFileSync(join(process.cwd(), 'src/app/api/concierge/checkout/route.ts'), 'utf8');

    expect(checkoutRoute).toContain('resolveServerPricedItem');
    expect(checkoutRoute).toContain('getMockProductServerPricing');
    expect(checkoutRoute).toContain('resolveTenantProductPricing');
    expect(checkoutRoute).not.toContain('const items = cart.items;');
  });
});
