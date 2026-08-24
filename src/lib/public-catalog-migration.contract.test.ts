import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824120000_public_catalog_view.sql'),
  'utf8',
);

describe('public catalog database contract', () => {
  it('is service-role only and preserves exact publication lineage', () => {
    expect(migration).toContain('with (security_invoker = true)');
    expect(migration).toContain('product_registration_customer_fact_view');
    expect(migration).toContain("snapshot.status = 'published'");
    expect(migration).toContain('snapshot.snapshot_hash = fact.snapshot_hash');
    expect(migration).toContain('revoke all on public.public_catalog_view from public, anon, authenticated');
    expect(migration).toContain('grant select on public.public_catalog_view to service_role');
  });

  it('fails closed for visibility, sales, marketing, future dates, deadlines, images and kill switches', () => {
    expect(migration).toContain('product_registration_customer_fact_view');
    expect(migration).toContain("package_json->>'marketing_eligible' = 'true'");
    expect(migration).toContain('try_iso_date');
    expect(migration).toContain("jsonb_array_length(coalesce(future_dates.available_dates, '[]'::jsonb)) > 0");
    expect(migration).toContain("package_json->>'ticketing_deadline'");
    expect(migration).toContain("package_json->>'hero_image_url'");
    expect(migration).toContain('product_registration_v5_kill_switches');
  });
});
