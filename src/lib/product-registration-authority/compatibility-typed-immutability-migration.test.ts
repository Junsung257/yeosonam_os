import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration compatibility typed immutability migration', () => {
  it('removes compatibility package backfills from append-only typed facts', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260812132000_product_registration_compatibility_preserve_typed_immutability.sql',
    ), 'utf8');

    expect(sql).toContain('update internal_product_registration.departure_instances');
    expect(sql).toContain('update internal_product_registration.transport_segments');
    expect(sql).toContain('update internal_product_registration.lodging_stays');
    expect(sql).toContain('update internal_product_registration.golf_rounds');
    expect(sql).toContain("execute replace(v_definition, v_legacy_updates, '')");
    expect(sql).toContain('REGISTRATION_COMPATIBILITY_TYPED_IMMUTABILITY_CONTRACT_UNKNOWN');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});
