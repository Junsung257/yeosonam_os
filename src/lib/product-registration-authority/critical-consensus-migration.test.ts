import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260816143532_product_registration_price_scope_and_critical_consensus.sql',
), 'utf8');

describe('critical fact and source bundle migration contract', () => {
  it('keeps consensus and exception decisions append-only and service-role only', () => {
    expect(migration).toContain('PRODUCT_REGISTRATION_CRITICAL_FACT_HISTORY_IMMUTABLE');
    expect(migration).toContain('force row level security');
    expect(migration).toMatch(/revoke all on table internal_product_registration\.critical_fact_consensus_decisions from public, anon, authenticated/iu);
    expect(migration).toMatch(/revoke all on function public\.record_product_registration_critical_fact_exception_review\(jsonb\)[\s\S]*from public, anon, authenticated/iu);
  });

  it('pins every security-definer RPC to an empty search path', () => {
    const securityDefinerFunctions = [...migration.matchAll(/create or replace function ([^(]+)[\s\S]*?security definer[\s\S]*?\$\$;/giu)];
    expect(securityDefinerFunctions.length).toBeGreaterThanOrEqual(5);
    for (const definition of securityDefinerFunctions) {
      expect(definition[0], definition[1]).toContain("set search_path = ''");
    }
  });

  it('only claims complementary same-upload bundles and makes coordinator lineage immutable', () => {
    expect(migration).toContain("p_payload->>'grouping_authority' <> 'upload_batch'");
    expect(migration).toContain("v_price_count <> 1 or v_itinerary_count <> 1");
    expect(migration).toContain('new.coordinator_job_id is distinct from old.coordinator_job_id');
    expect(migration).toContain('new.coordinator_source_document_id is distinct from old.coordinator_source_document_id');
  });
});
