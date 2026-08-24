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
    expect(migration).toContain('product_registration_customer_departure_fact_view');
    expect(migration).toContain("departure.pricing_state = 'PRICED'");
    expect(migration).toContain("departure.pricing_state = 'REQUEST_ONLY'");
    expect(migration).toContain("departure.sale_state in ('available', 'request')");
    expect(migration).not.toContain("package_json->'price_dates'");
    expect(migration).toContain("snapshot.status = 'published'");
    expect(migration).toContain('snapshot.snapshot_hash = fact.snapshot_hash');
    expect(migration).toContain("'card_projection', normalized.card_projection");
    expect(migration).toContain("'lp_projection', normalized.lp_projection");
    expect(migration).toContain("'route_text_dump', normalized.route_text_dump");
    expect(migration).toContain("'renderer_build_id', normalized.renderer_build_id");
    expect(migration).toContain('revoke all on public.public_catalog_view from public, anon, authenticated');
    expect(migration).toContain('grant select on public.public_catalog_view to service_role');
  });

  it('fails closed for visibility, sales, marketing, future dates, deadlines, images and kill switches', () => {
    expect(migration).toContain('product_registration_customer_fact_view');
    expect(migration).toContain("package_json->>'marketing_eligible' = 'true'");
    expect(migration).toContain('try_iso_date');
    expect(migration).toContain("jsonb_array_length(coalesce(future_departures.available_dates, '[]'::jsonb)) > 0");
    expect(migration).toContain("package_json->>'ticketing_deadline'");
    expect(migration).toContain("package_json->>'hero_image_url'");
    expect(migration).toContain('product_registration_v5_kill_switches');
  });
});
