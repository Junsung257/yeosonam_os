import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260829112748_product_registration_customer_readiness_v3.sql'),
  'utf8',
);
const appendOnlyLineageMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260829131745_product_registration_append_only_price_lineage.sql'),
  'utf8',
);

describe('product registration customer readiness V3 migration', () => {
  it('preserves source price meaning in the atomic revision commit', () => {
    expect(migration).toContain('source_price_kind');
    expect(migration).toContain("source_price_kind in ('NET', 'SELLING', 'REQUEST_ONLY')");
    expect(migration).toContain("source_price_kind = 'NET' and source_amount is not null and net_price = source_amount");
    expect(migration).toContain("source_price_kind = 'SELLING' and source_amount is not null and net_price is null");
    expect(migration).toContain('REGISTRATION_V62_SYNTHETIC_NET_FORBIDDEN');
    expect(migration).toContain('REGISTRATION_V62_REQUEST_ONLY_NUMERIC_PRICE_FORBIDDEN');
    expect(migration).toContain('departure_price_lineage');
    expect(migration).toContain('REGISTRATION_V62_PRICE_LINEAGE_IDEMPOTENCY_CONFLICT');
    expect(migration).toContain('on conflict (departure_instance_id) do nothing');
    expect(migration).toContain('trg_pr_departure_price_lineage_immutable');
    expect(migration).not.toContain('update internal_product_registration.departure_instances');
    expect(migration).toContain('source_price_kind is null\n    or (pricing_state = \'PRICED\'');
    expect(migration).toContain('commit_revision_v61_knowledge_atomic(p_payload)');
    expect(migration).toContain('commit_product_registration_revision_v62_atomic');
  });

  it('repairs already-migrated databases without weakening immutable V6 facts', () => {
    expect(appendOnlyLineageMigration).toContain('create table if not exists internal_product_registration.departure_price_lineage');
    expect(appendOnlyLineageMigration).toContain('before update or delete on internal_product_registration.departure_price_lineage');
    expect(appendOnlyLineageMigration).toContain('internal_product_registration.reject_mutation()');
    expect(appendOnlyLineageMigration).toContain('join internal_product_registration.departure_price_lineage lineage');
    expect(appendOnlyLineageMigration).toContain('lineage.id is null');
    expect(appendOnlyLineageMigration).not.toContain('update internal_product_registration.departure_instances');
  });

  it('requires grounded copy V3, future typed departures and documentary media', () => {
    expect(migration).toContain("copy.copy_policy_version = 'product-registration-customer-copy-v3'");
    expect(migration).toContain('copy.quality_score >= 82');
    expect(migration).toContain("normalized.customer_copy->>'copy_policy_version' = 'product-registration-customer-copy-v3'");
    expect(migration).toContain("normalized.package_json->>'media_readiness_state' = 'verified_documentary'");
    expect(migration).toContain("departure.departure_date >= (now() at time zone 'Asia/Seoul')::date");
    expect(migration).toContain('create or replace view public.product_registration_customer_departure_fact_view');
    expect(migration).toContain("departure.source_price_kind in ('NET', 'SELLING')");
    expect(migration).toContain("departure.source_price_kind = 'REQUEST_ONLY'");
    expect(migration).toContain("normalized.hero_image !~* '(^|/)logo(?:[._/-]|$)'");
    expect(migration).toContain('admin_package_customer_readiness_v3');
    expect(migration).toContain('actual_customer_catalog_public');
    expect(migration).toContain('customer_readiness_blocker_codes');
    expect(migration).toContain("media_asset.content_safety_state = 'safe'");
    expect(migration).toContain("media_asset.relevance_state = 'verified'");
  });

  it('keeps exposed functions and the catalog service-role only', () => {
    expect(migration).toContain('set search_path = \'\'');
    expect(migration).toContain('revoke all on function public.commit_product_registration_revision_v62_atomic(jsonb)');
    expect(migration).toContain('revoke all on public.public_catalog_view from public, anon, authenticated');
    expect(migration).toContain('grant select on public.public_catalog_view to service_role');
    expect(migration).not.toContain('grant select on public.public_catalog_view to authenticated');
  });
});
