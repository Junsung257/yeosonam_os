import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration compatibility generated-price migration', () => {
  it('derives net price and asserts generated selling-price parity', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260812125000_product_registration_compatibility_generated_price.sql',
    ), 'utf8');

    expect(sql).toContain('net_price, selling_price, margin_rate');
    expect(sql).toContain('net_price, margin_rate, departure_region');
    expect(sql).toContain("(nullif(v_projection->>''price'', '''')::numeric + coalesce(discount_amount, 0))");
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_MARGIN_RATE_INVALID');
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_SELLING_PRICE_PARITY_MISMATCH');
    expect(sql).toContain('projected_product.selling_price');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});
