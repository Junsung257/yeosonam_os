import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return fs.readFileSync(`${root}/${path}`, 'utf8');
}

describe('product registration authority hardening contracts', () => {
  it('reconciles legacy identity only inside the same tenant', () => {
    const migration = source('supabase/migrations/20260811115754_product_registration_tenant_identity_reconciliation.sql');
    expect(migration).toContain('pr.tenant_id = match.tenant_id');
    expect(migration).toContain('alter column tenant_id set not null');
    expect(migration).toContain('alter column catalog_product_id set not null');
    expect(migration).toContain('REGISTRATION_TENANT_IDENTITY_RECONCILIATION_BLOCKED');
  });

  it('keeps publication frozen until the explicit finalizer validates authority', () => {
    const migration = source('supabase/migrations/20260811112045_product_registration_authority_hardening.sql');
    expect(migration).toContain('finalize_product_registration_authority_hardening');
    expect(migration).toContain('REGISTRATION_FINALIZE_REQUIRES_PUBLICATION_FREEZE');
    expect(migration).toContain("'publish_package_snapshot_atomic'");
    expect(migration).toContain("execute format('revoke execute on function %s");
    expect(migration).toContain('has_function_privilege');
  });

  it('opens only exact source-proof publications during shadow/freeze mode', () => {
    const migration = source('supabase/migrations/20260818154354_product_registration_source_proof_open_path.sql');
    expect(migration).toContain("p_payload->>'source_proof_auto_publish' = 'true'");
    expect(migration).toContain("app.product_registration_source_proof");
    expect(migration).toContain('v_mode = \'shadow\' and v_source_proof_mode');
    expect(migration).toContain('v_freeze and not v_source_proof_mode');
    expect(migration).toContain('REGISTRATION_SOURCE_PROOF_FREEZE_TRIGGER_CONTRACT_UNKNOWN');
  });

  it('persists customer proof against the current immutable pointer without legacy row mutation', () => {
    const proofPersistence = source('src/lib/product-registration-v6/customer-proof-persistence.ts');
    const browserScript = source('scripts/prove-hwp-mobile-render.ts');
    expect(proofPersistence).toContain("from('product_registration_v5_publication_pointers')");
    expect(proofPersistence).toContain("from('public_package_snapshots')");
    expect(proofPersistence).toContain("source: 'hwp-mobile-browser-proof'");
    expect(proofPersistence).toContain('legacyPackageMutation: false');
    expect(browserScript).toContain('loadCurrentCustomerSnapshotBinding');
    expect(browserScript).toContain('persistCustomerMobileSnapshotProof');
    expect(browserScript).not.toContain('persistPassProof');
    expect(browserScript).not.toContain('persistFailProof');
    expect(browserScript).not.toContain("from('travel_packages').update");
  });

  it('prevents a published pointer from committing without the exact published snapshot and proof', () => {
    const migration = source('supabase/migrations/20260813034932_product_registration_publication_pointer_invariant.sql');
    expect(migration).toContain('create constraint trigger trg_product_registration_published_pointer_integrity');
    expect(migration).toContain('deferrable initially deferred');
    expect(migration).toContain("s.status = 'published'");
    expect(migration).toContain("p.status = 'passed'");
    expect(migration).toContain('p.renderer_build_id = s.renderer_build_id');
    expect(migration).toContain("lower(s.renderer_build_id) !~ '^(local|dev|development|unknown)");
    expect(migration).toContain('REGISTRATION_PUBLISHED_POINTER_INTEGRITY_VIOLATION');
    expect(migration).toContain("'publication_pointer_quarantined'");
    expect(migration).toContain("set state = 'blocked', pointer_version = pointer_version + 1");
  });

  it('keeps proof-bound public snapshot bodies append-only', () => {
    const migration = source('supabase/migrations/20260813041000_product_registration_snapshot_immutability.sql');
    expect(migration).toContain('guard_public_snapshot_immutability');
    expect(migration).toContain('REGISTRATION_PUBLIC_SNAPSHOT_BODY_IMMUTABLE');
    expect(migration).toContain('REGISTRATION_PUBLIC_SNAPSHOT_DELETE_FORBIDDEN');
    expect(migration).toContain('REGISTRATION_PUBLIC_SNAPSHOT_STILL_REFERENCED');
    expect(migration).toContain('old.snapshot_json is distinct from new.snapshot_json');
    expect(migration).toContain('old.snapshot_hash is distinct from new.snapshot_hash');
    expect(migration).toContain("p.state = 'published'");
  });

  it('backfills through one shadow workflow and heals a lost follow-up bind', () => {
    const route = source('src/app/api/cron/product-registration-v6-backfill/route.ts');
    const migration = source('supabase/migrations/20260811121526_product_registration_legacy_backfill_ledger.sql');
    expect(route).toContain('startProductRegistrationTextWorkflow');
    expect(route).toContain('archiveMode: false');
    expect(route).toContain("bindingKind: 'legacy_backfill'");
    expect(route).toContain('targetTitle:');
    expect(route).toContain('targetInternalCode:');
    expect(route).toContain("throw new Error('LEGACY_SOURCE_TEXT_UNAVAILABLE')");
    expect(route).not.toContain(".from('travel_packages').insert");
    expect(migration).toContain("j.v4_stage_state->>'authorityBindingOperationKey'");
    expect(migration).toContain("'legacy-backfill:' || b.id::text");
    const terminalSyncMigration = source('supabase/migrations/20260812154000_product_registration_backfill_terminal_sync.sql');
    expect(terminalSyncMigration).toContain('trg_sync_legacy_backfill_terminal_state');
    expect(terminalSyncMigration).toContain("case when length(btrim(coalesce(p.raw_text, ''))) >= 50 then 100");
  });

  it('reserves provider effects with a durable retry ceiling', () => {
    const migration = source('supabase/migrations/20260811115946_product_registration_provider_idempotency.sql');
    expect(migration).toContain('reserve_product_registration_v6_provider_call');
    expect(migration).toContain('complete_product_registration_v6_provider_call');
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain('attempt_count >= 3');
    expect(source('src/lib/product-registration-v6/schedule-revalidation.ts'))
      .toContain('operationScope: `revalidation:${input.job.id}:${input.job.checkpoint}:segment:${index}`');
  });

  it('seeds legacy flight observations only from dated source-evidenced rows', () => {
    const migration = source('supabase/migrations/20260813035515_product_registration_legacy_transport_observation_seed.sql');
    expect(migration).toContain("p.departure_date is not null");
    expect(migration).toContain("position(upper(p.flight_info->>'flight_no')");
    expect(migration).toContain("position(p.flight_info->>'depart'");
    expect(migration).toContain("position(p.flight_info->>'arrive'");
    expect(migration).toContain("'verified_product'");
    expect(migration).toContain("'verified-product-source:'");
    expect(migration).toContain('effective_start, effective_end');
    expect(migration).toContain('on conflict do nothing');
  });

  it('covers Product Registration foreign keys used by backfill and durable workflows', () => {
    const migration = source('supabase/migrations/20260812155000_product_registration_foreign_key_indexes.sql');
    const publicMigration = source('supabase/migrations/20260813042000_product_registration_public_fk_indexes.sql');
    expect(migration).toContain("('legacy_backfill_jobs', 'workflow_job_id')");
    expect(migration).toContain("('dead_letter_jobs', 'job_id')");
    expect(migration).toContain("('transport_segments', 'departure_instance_id')");
    expect(migration).toContain("('provider_calls', 'product_revision_id')");
    expect(publicMigration).toContain('product_registration_drafts(extraction_id)');
    expect(publicMigration).toContain('product_registration_v5_proof_runs(catalog_product_id)');
    expect(publicMigration).toContain('product_registration_v5_publication_pointers(tenant_id, catalog_product_id)');
    expect(publicMigration).toContain('public_package_snapshots(tenant_id, catalog_product_id)');
  });

  it('prioritizes a bounded corrected-engine retry ahead of unseen legacy inventory', () => {
    const migration = source('supabase/migrations/20260812156000_product_registration_backfill_retry_priority.sql');
    expect(migration).toContain("case when b.status = 'failed' then 1000 else 0 end desc");
    expect(migration).toContain('b.attempt_count < 3');
  });

  it('scopes retry ceilings to an explicit deployed engine version', () => {
    const route = source('src/app/api/cron/product-registration-v6-backfill/route.ts');
    const migration = source('supabase/migrations/20260813001000_product_registration_backfill_engine_version.sql');
    expect(route).toContain('p_engine_version: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION');
    expect(migration).toContain('total_attempt_count');
    expect(migration).toContain("b.last_error like 'WORKFLOW_FAILED:%'");
    expect(migration).toContain('engine_version is distinct from v_engine_version');
    expect(source('supabase/migrations/20260813002000_product_registration_backfill_attempt_audit.sql'))
      .toContain('greatest(total_attempt_count, attempt_count)');
  });

  it('pins the Korea reference date and rejects past canonical facts in the database', () => {
    const migration = source('supabase/migrations/20260816143528_product_registration_future_departure_guard.sql');
    const weekdayPolicyMigration = source('supabase/migrations/20260816143534_product_registration_source_weekday_policy_v3.sql');
    const boundedYearlessPolicyMigration = source('supabase/migrations/20260816143541_product_registration_yearless_departure_policy_v4.sql');
    expect(migration).toContain('v6_reference_date');
    expect(migration).toContain("timezone('Asia/Seoul', now())::date");
    expect(migration).toContain('REGISTRATION_DEPARTURE_REFERENCE_IMMUTABLE');
    expect(migration).toContain('REGISTRATION_PAST_DEPARTURE_REJECTED');
    expect(migration).toContain('REGISTRATION_PAST_PRICE_DATE_REJECTED');
    expect(migration).toContain('REGISTRATION_UNCLIPPED_PRICE_RANGE_REJECTED');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = pg_catalog, pg_temp');
    expect(migration).toContain('revoke all on function internal_product_registration.reject_past_product_fact_write()');
    expect(weekdayPolicyMigration).toContain("set default 'source-departure-date-policy-3'");
    expect(weekdayPolicyMigration).toContain("'source-departure-date-policy-2'");
    expect(weekdayPolicyMigration).toContain("'source-departure-date-policy-3'");
    expect(weekdayPolicyMigration).toContain('REGISTRATION_PAST_DEPARTURE_REJECTED');
    expect(weekdayPolicyMigration).toContain('set search_path = pg_catalog, pg_temp');
    expect(weekdayPolicyMigration).toContain('revoke all on function internal_product_registration.reject_past_product_fact_write()');
    expect(boundedYearlessPolicyMigration).toContain("set default 'source-departure-date-policy-4'");
    expect(boundedYearlessPolicyMigration).toContain("'source-departure-date-policy-2'");
    expect(boundedYearlessPolicyMigration).toContain("'source-departure-date-policy-3'");
    expect(boundedYearlessPolicyMigration).toContain("'source-departure-date-policy-4'");
    expect(boundedYearlessPolicyMigration).toContain('set search_path = pg_catalog, pg_temp');
    expect(boundedYearlessPolicyMigration).toContain('revoke all on function internal_product_registration.reject_past_product_fact_write()');
  });

  it('keeps golf facts immutable while permitting atomic aggregate construction', () => {
    const migration = source('supabase/migrations/20260812113000_product_registration_atomic_golf_linkage.sql');
    const jsonSafeMigration = source('supabase/migrations/20260812123000_product_registration_atomic_golf_linkage_json_safe.sql');
    expect(migration).toContain("v_writer = 'registration-kernel'");
    expect(migration).toContain("tg_table_name = 'golf_rounds'");
    expect(migration).toContain("v_old - 'golf_fact_resolution_id'");
    expect(migration).toContain("tg_table_name = 'golf_fact_observations'");
    expect(migration).toContain("tg_table_name = 'golf_fact_resolutions'");
    expect(migration).toContain('old.observation_ids <@ new.observation_ids');
    expect(migration).toContain("raise exception '% is append-only");
    expect(jsonSafeMigration).toContain("(v_new->>'observed_at')::timestamptz");
    expect(jsonSafeMigration).toContain("v_new->'observation_ids'");
    expect(jsonSafeMigration).not.toContain('new.observed_at');
    expect(jsonSafeMigration).not.toContain('old.observation_ids <@ new.observation_ids');
  });

  it('terminates a genuinely price-less source without creating a publishable failure', () => {
    const migration = source('supabase/migrations/20260816143538_product_registration_discard_missing_sale_price_source.sql');
    expect(migration).toContain("'discarded_source_incomplete'");
    expect(migration).toContain('V6_DISCARDED_SOURCE_PUBLICATION_FORBIDDEN');
    expect(migration).toContain("then 'done'");
    expect(migration).toContain("then 'verified'");
    expect(migration).toContain('v_job.v6_outcome is distinct from v_compatibility_outcome');
    expect(migration).toMatch(/revoke all on function internal_product_registration\.record_terminal_state\(jsonb\)[\s\S]*from public, anon, authenticated/iu);
  });

  it('only allows dual-AI candidates through source replay before canonical facts', () => {
    const workflow = source('src/workflows/product-registration-v6.ts');
    expect(workflow).toContain('async function resolveCriticalFactsStep(');
    expect(workflow).toContain('runCriticalPriceFactAutomation');
    expect(workflow).toContain('dual_ai_consensus_and_deterministic_source_replay');
    expect(workflow).toContain('criticalFactOverrides: automated.overrides');
    expect(workflow).not.toContain('AI_FACT_AUTHORITY_PROHIBITED');
  });

  it('prevents agent actions from creating or mutating mutable package rows', () => {
    const executor = source('src/lib/agent-action-executor.ts');
    expect(executor).toContain('AGENT_PACKAGE_CREATE_RETIRED_USE_SOURCE_REGISTRATION_WORKFLOW');
    expect(executor).toContain('AGENT_PACKAGE_STATUS_MUTATION_RETIRED_USE_AVAILABILITY_OVERLAY');
    expect(executor).not.toMatch(/create_package:[\s\S]{0,500}from\('travel_packages'\)/u);
    expect(executor).not.toMatch(/update_package_status:[\s\S]{0,500}from\('travel_packages'\)/u);
  });

  it('keeps scoring matches and upload verification read-only against customer package facts', () => {
    const matcher = source('src/lib/scoring/match-land-operators.ts');
    const verifier = source('src/lib/upload-verify.ts');

    expect(matcher).toContain('correction_candidates');
    expect(matcher).toContain("evidence: 'bookings_mode' | 'registered_alias'");
    expect(matcher).not.toMatch(/\.from\('travel_packages'\)[\s\S]{0,120}\.update\(/u);
    expect(verifier).toContain(".from('ai_quality_log')");
    expect(verifier).not.toMatch(/\.from\('travel_packages'\)[\s\S]{0,160}\.update\(/u);
  });

  it('turns Jarvis product commands into Kernel candidates instead of mutable package writes', () => {
    const productsAgent = source('src/lib/jarvis/agents/products.ts');

    expect(productsAgent).toContain("action_type: 'register_product'");
    expect(productsAgent).toContain("action_type: 'correct_product'");
    expect(productsAgent).toContain("action_type: 'retire_product'");
    expect(productsAgent).toContain("fact_authority: 'none_requires_source_evidence'");
    expect(productsAgent).not.toMatch(/\.from\('travel_packages'\)[\s\S]{0,180}\.(?:insert|update|delete)\(/u);
  });

  it('has no legacy product-registration writer allowlist', () => {
    const baseline = JSON.parse(source('scripts/product-registration-authority-legacy-writers.json')) as {
      legacyWriters?: unknown[];
    };

    expect(baseline.legacyWriters).toEqual([]);
  });
});
