import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260819073009_blog_v4_content_factory.sql',
  'utf8',
).toLowerCase();
const rollback = readFileSync(
  'supabase/rollbacks/blog-v4-content-factory-20260819.sql',
  'utf8',
).toLowerCase();
const terminalizationMigration = readFileSync(
  'supabase/migrations/20260824114843_blog_v4_operation_terminalization.sql',
  'utf8',
).toLowerCase();
const stagingQualityRepairMigration = readFileSync(
  'supabase/migrations/20260826060456_blog_v4_staging_quality_repair.sql',
  'utf8',
).toLowerCase();
const stagingFailedQualityRepairMigration = readFileSync(
  'supabase/migrations/20260826062634_blog_v4_staging_quality_repair_failed.sql',
  'utf8',
).toLowerCase();
const revisionQualityDecisionMigration = readFileSync(
  'supabase/migrations/20260826082731_blog_v4_revision_quality_decision_20260826.sql',
  'utf8',
).toLowerCase();

describe('Blog V4 content factory migration contract', () => {
  it('creates the four service-role ledgers with RLS and explicit grants', () => {
    for (const table of [
      'blog_demand_clusters',
      'blog_demand_cluster_signals',
      'blog_content_operations',
      'blog_content_stage_events',
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });

  it('contains atomic materialization, claim, bind and fenced stage RPCs', () => {
    expect(migration).toContain('materialize_blog_content_operation_v4');
    expect(migration).toContain('claim_blog_content_operation_v4');
    expect(migration).toContain('bind_blog_content_operation_workflow_v4');
    expect(migration).toContain('claim_blog_content_operation_publication_v4');
    expect(migration).toContain('record_blog_content_stage_event_v4');
    expect(migration).toContain('blog_content_operation_fencing_conflict');
    expect(migration).toContain('on conflict (operation_id, event_key) do nothing');
    expect(migration).toContain('publication_day_kst = p_operation_day_kst');
    expect(migration).toContain('where publication_day_kst = p_operation_day_kst');
    expect(migration).toContain('blog_content_operation_generation_run_not_claimable');
    expect(migration).toContain("where id = v_run.id and status = 'approved_for_slot'");
    expect(migration).toContain('blog_content_operation_generation_run_claim_race');
    expect(migration).toContain('on conflict (provider, source_row_hash) do nothing');
    expect(migration).toContain('blog_demand_signal_cluster_conflict');
    expect(migration).toContain('v_expires_at, v_verified_at');
    expect(migration).toContain("lease_expires_at = now() + interval '15 minutes'");
  });

  it('adds one fenced terminalizer for fatal and review handoffs', () => {
    expect(terminalizationMigration).toContain('terminalize_blog_content_operation_v4');
    expect(terminalizationMigration).toContain('requeue_blog_content_operation_v4');
    expect(terminalizationMigration).toContain('fencing_token = fencing_token + 1');
    expect(terminalizationMigration).toContain("status not in (\n    'failed', 'human_review', 'approved_for_slot'");
    expect(terminalizationMigration).toContain('lease_owner = null');
    expect(terminalizationMigration).toContain('lease_expires_at = null');
    expect(terminalizationMigration).toContain('completed_at = coalesce(completed_at, now())');
    expect(terminalizationMigration).toContain('to service_role');
  });

  it('limits human-review requeue to an explicitly seeded draft-only staging queue', () => {
    expect(stagingQualityRepairMigration).toContain("v_operation.status = 'human_review'");
    expect(stagingQualityRepairMigration).toContain("v_queue.source = 'user_seed'");
    expect(stagingQualityRepairMigration).toContain("v_queue.meta ->> 'blog_v4_staging_seed'");
    expect(stagingQualityRepairMigration).toContain("v_queue.meta ->> 'publication_disposition' = 'draft_only'");
    expect(stagingQualityRepairMigration).toContain("status = 'pending_review'");
    expect(stagingQualityRepairMigration).toContain('to service_role');
  });

  it('also limits failed-operation recovery to the same staging owner boundary', () => {
    expect(stagingFailedQualityRepairMigration).toContain("v_operation.status in ('human_review', 'failed')");
    expect(stagingFailedQualityRepairMigration).toContain("v_queue.source = 'user_seed'");
    expect(stagingFailedQualityRepairMigration).toContain("v_queue.meta ->> 'blog_v4_staging_seed'");
    expect(stagingFailedQualityRepairMigration).toContain("v_queue.meta ->> 'publication_disposition' = 'draft_only'");
    expect(stagingFailedQualityRepairMigration).toContain('to service_role');
  });

  it('pins one immutable revision to one final quality decision and normalizes operation state', () => {
    expect(revisionQualityDecisionMigration).toContain('create table if not exists public.blog_content_revisions');
    expect(revisionQualityDecisionMigration).toContain('create table if not exists public.blog_quality_decisions');
    expect(revisionQualityDecisionMigration).toContain('blog_quality_decision_pass_consistency');
    expect(revisionQualityDecisionMigration).toContain('final_revision_id');
    expect(revisionQualityDecisionMigration).toContain('final_quality_decision_id');
    expect(revisionQualityDecisionMigration).toContain("'completed'");
    expect(revisionQualityDecisionMigration).toContain('trg_blog_content_revisions_immutable');
    expect(revisionQualityDecisionMigration).toContain('to service_role');
  });

  it('publishes commercial content and its indexing outbox in one fenced transaction', () => {
    expect(migration).toContain('publish_blog_commercial_operation_v4');
    expect(migration).toContain("'content_factory_commercial_atomic_publish'");
    expect(migration).toContain('blog_commercial_package_snapshot_stale');
    expect(migration).toContain('blog_commercial_selected_attempt_not_publishable');
    expect(migration).toContain("'publication:commercial-atomic:v1'");
    expect(migration).toContain('blog_commercial_indexing_outbox_failed');
  });

  it('moves a published operation to indexed only after a succeeded outbox job', () => {
    expect(migration).toContain('mark_blog_content_operation_indexed_v4');
    expect(migration).toContain("where id = p_indexing_job_id and status = 'succeeded'");
    expect(migration).toContain("set status = 'indexed', current_stage = 'indexed'");
  });

  it('keeps stage events append-only and stores no competitor body column', () => {
    expect(migration).toContain('blog_content_stage_events_append_only');
    expect(migration).not.toMatch(/competitor_(?:body|content)|source_body/);
  });

  it('requires immutable product snapshot lineage for commercial operations', () => {
    expect(migration).toContain('blog_content_operations_commercial_snapshot_required');
    expect(migration).toContain("operation_type not in ('new_commercial', 'product_refresh') or package_snapshot_id is not null");
    expect(migration).toContain('blog_content_operations_refresh_target_required');
    expect(migration).toContain("operation_type not in ('material_refresh', 'product_refresh') or target_creative_id is not null");
    expect(migration).toContain("v_operation.operation_type = 'product_refresh'");
    expect(migration).toContain("material_update_reason = 'immutable_product_snapshot_refresh'");
    expect(migration).toContain("set status = 'archived', published_at = null");
  });

  it('drops the append-only trigger before its trigger function during rollback', () => {
    expect(rollback.indexOf('drop trigger if exists trg_blog_content_stage_events_append_only'))
      .toBeGreaterThan(-1);
    expect(rollback.indexOf('drop trigger if exists trg_blog_content_stage_events_append_only'))
      .toBeLessThan(rollback.indexOf('drop function if exists public.prevent_blog_content_stage_event_mutation_v4'));
  });
});
