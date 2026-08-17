import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260817023000_supplier_profile_activation_gate.sql`,
  'utf8',
);

describe('supplier profile activation migration', () => {
  it('requires reviewed scale, exactness and zero critical false publications', () => {
    expect(migration).toContain('v_section_count < 30');
    expect(migration).toContain('v_lineage_count < 10');
    expect(migration).toContain('v_run.critical_false_publish_count <> 0');
    expect(migration).toContain('v_run.exact_match_rate, 0) < 0.995');
  });

  it('is service-role only with a pinned search path', () => {
    expect(migration).toContain('set search_path = pg_catalog, public, internal_product_registration, pg_temp');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });
});
