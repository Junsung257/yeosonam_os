import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationRoot = join(process.cwd(), 'supabase', 'migrations');
const convergenceSql = readFileSync(join(migrationRoot, '20260811074521_product_registration_authority_convergence.sql'), 'utf8');
const authoritySql = readFileSync(join(migrationRoot, '20260819235142_product_registration_v61_authority.sql'), 'utf8');
const workflowSql = readFileSync(join(migrationRoot, '20260819235152_product_registration_v61_workflow.sql'), 'utf8');
const lineageSql = readFileSync(join(migrationRoot, '20260819235155_product_registration_v61_surface_lineage.sql'), 'utf8');
const knowledgeSql = readFileSync(join(migrationRoot, '20260820100000_product_registration_v61_knowledge_ledger.sql'), 'utf8');
const appendOnlyOverrideSql = readFileSync(join(migrationRoot, '20260829133007_product_registration_v61_price_override_append_only.sql'), 'utf8');
const repositorySource = readFileSync(join(process.cwd(), 'src', 'lib', 'product-registration-authority', 'repository.ts'), 'utf8');

describe('V6.1 authority contract', () => {
  it('uses a runtime freeze manifest and refuses hardcoded customer counts', () => {
    expect(authoritySql).toContain('publication_freeze_manifests');
    expect(authoritySql).toContain('v_expected_count');
    expect(authoritySql).toContain('REGISTRATION_FREEZE_MANIFEST_COUNT_MISMATCH');
    expect(authoritySql).toContain('p_manifest_id');
    expect(authoritySql).toContain('p_manifest_hash');
    expect(authoritySql).not.toMatch(/\b(?:9|11)\s+customer\s+pointer/i);
  });

  it('requires exact one-time release authorization for frozen publication', () => {
    expect(authoritySql).toContain('publication_release_authorizations');
    expect(authoritySql).toContain("p_payload->>'release_authorization_id'");
    expect(authoritySql).toContain('consumed_at');
    expect(authoritySql).toContain('expected_pointer_version');
    expect(authoritySql).toContain('revision_hash');
    expect(authoritySql).toContain('snapshot_hash');
    expect(authoritySql).toContain('proof_hash');
    expect(authoritySql).toContain('REGISTRATION_RELEASE_AUTHORIZATION_REQUIRED');
  });

  it('models retries as fenced attempts and separates terminal outcome', () => {
    expect(workflowSql).toContain('attempt_no');
    expect(workflowSql).toContain('fencing_token');
    expect(workflowSql).toContain('idx_pr_v61_stage_attempt_unique');
    expect(workflowSql).toContain('stage_name, stage_version, input_hash, attempt_no');
    expect(workflowSql).toContain("registration_job_state = 'TERMINAL'");
    expect(workflowSql).toContain('registration_terminal_outcome = null');
    expect(workflowSql).toContain("p_payload->>'fencing_token'");
  });

  it('keeps surface artifacts and proof hashes below the customer snapshot hash', () => {
    expect(lineageSql).toContain('surface_render_artifacts');
    expect(lineageSql).toContain('customer_snapshot_hash');
    expect(lineageSql).toContain('surface_render_hash');
    expect(authoritySql).toContain('proof_hash');
    expect(lineageSql).toContain('package_detail');
    expect(lineageSql).toContain('landing_page');
    expect(lineageSql).toContain('a4_artifact');
  });

  it('keeps canonical revision writes behind one transaction-facing RPC', () => {
    expect(convergenceSql).toContain('create or replace function internal_product_registration.commit_revision_atomic');
    expect(convergenceSql).toContain('pg_advisory_xact_lock');
    expect(convergenceSql).toContain('insert into public.product_registration_v5_revisions');
    expect(convergenceSql).toContain('insert into public.product_registration_v5_claims');
    expect(convergenceSql).toContain('insert into public.product_registration_v5_price_rules');
    expect(convergenceSql).toContain('insert into public.product_registration_v5_itinerary_items');
    expect(convergenceSql).toContain('insert into internal_product_registration.departure_instances');
    expect(convergenceSql).toContain('insert into internal_product_registration.transport_segments');
    expect(convergenceSql).toContain('insert into internal_product_registration.lodging_stays');
    expect(convergenceSql).toContain('insert into internal_product_registration.golf_rounds');
    expect(convergenceSql).toContain('insert into internal_product_registration.terms_revisions');
    expect(convergenceSql).toContain('create or replace function public.commit_product_registration_revision_atomic');
    expect(knowledgeSql).toContain('create or replace function public.commit_product_registration_revision_v61_atomic');
    expect(knowledgeSql).toContain('internal_product_registration.commit_revision_atomic(p_payload)');
    expect(knowledgeSql).toContain('price_date_overrides');
    expect(knowledgeSql).toContain('on conflict (revision_id, override_key) do nothing');
    expect(knowledgeSql).toContain('REGISTRATION_V61_OVERRIDE_IDEMPOTENCY_CONFLICT');
    expect(knowledgeSql).not.toContain('update internal_product_registration.departure_instances');
    expect(appendOnlyOverrideSql).toContain('on conflict (revision_id, override_key) do nothing');
    expect(appendOnlyOverrideSql).toContain('REGISTRATION_V61_OVERRIDE_IDEMPOTENCY_CONFLICT');
    expect(appendOnlyOverrideSql).toContain('trg_pr_v61_price_date_overrides_immutable');
    expect(appendOnlyOverrideSql).not.toContain('update internal_product_registration.departure_instances');
    expect(repositorySource).toContain("rpc('commit_product_registration_revision_v62_atomic'");
    expect(repositorySource).toContain("rpc('project_product_registration_compatibility_atomic'");
    expect(repositorySource).not.toContain("rpc('insert_product_registration'");
  });

  it('consumes the exact release authorization and pointer CAS in the same publication function', () => {
    expect(authoritySql).toContain('create or replace function public.publish_product_registration_snapshot_atomic');
    expect(authoritySql).toContain('where authorization_id = v_authorization.authorization_id and consumed_at is null');
    expect(authoritySql).toContain('if not found then raise exception \'REGISTRATION_RELEASE_AUTHORIZATION_CONSUME_CONFLICT\'');
    expect(convergenceSql).toContain('update public.product_registration_v5_publication_pointers');
    expect(convergenceSql).toContain('where package_id = v_package_id and channel = v_channel and locale = v_locale');
    expect(convergenceSql).toContain('v_expected_pointer_version');
    expect(authoritySql).toContain('insert into public.product_registration_v5_publication_outbox');
  });

  it('keeps typed departure, entity, overlay, and audience facts behind V6.1 authority', () => {
    expect(knowledgeSql).toContain('adult_selling_price numeric(12,2)');
    expect(knowledgeSql).toContain('price_date_overrides');
    expect(knowledgeSql).toContain('pricing_state');
    expect(knowledgeSql).toContain('booking_state');
    expect(knowledgeSql).toContain('catalog_entities');
    expect(knowledgeSql).toContain('product_entity_relations');
    expect(knowledgeSql).toContain('supplier_overlays');
    expect(knowledgeSql).toContain('product_revision_overlays');
    expect(knowledgeSql).toContain('product_registration_jarvis_fact_view');
    expect(knowledgeSql).toContain('browser_proofs');
    expect(knowledgeSql).toContain('proof_gate.status = \'passed\'');
    expect(knowledgeSql).toContain('product_registration_blog_content_fact_view');
    expect(knowledgeSql).toContain('product_registration_comparison_fact_view');
    expect(knowledgeSql).toContain('revoke all on public.product_registration_jarvis_fact_view');
  });
});
