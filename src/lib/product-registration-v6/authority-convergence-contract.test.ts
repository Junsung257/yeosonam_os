import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('registration kernel authority convergence', () => {
  it('builds snapshots from immutable revision aggregates without reading compatibility facts', () => {
    const snapshot = source('src/lib/product-registration-v6/snapshot-publication.ts');
    const publicationControl = source('src/lib/product-registration-v6/publication-control.ts');

    expect(snapshot).toContain('loadProductRegistrationRevisionAggregate');
    expect(snapshot).toContain('compatibilityBindings');
    expect(snapshot).not.toContain(".from('travel_packages')");
    expect(publicationControl).not.toContain(".from('travel_packages')");
  });

  it('keeps catalog IDs authoritative after compatibility projection', () => {
    const workflow = source('src/workflows/product-registration-v6.ts');

    expect(workflow).toContain('const normalized = { ...canonical, packageIds: canonical.catalogProductIds }');
    expect(workflow).toContain('compatibility.bindings');
    expect(workflow).not.toContain('projectedDecision');
    expect(workflow).not.toContain('projectedShared');
  });

  it('has exactly one upload execution path and fails closed when Kernel workflow is disabled', () => {
    const upload = source('src/app/api/upload/route.ts');

    expect(upload).toContain('startProductRegistrationWorkflowBySourceId');
    expect(upload).toContain('REGISTRATION_KERNEL_WORKFLOW_DISABLED');
    expect(upload).not.toContain('runUploadRegistrationPipeline');
    expect(upload).not.toContain('createProductRegistrationV4Job');
    expect(upload).not.toContain('enqueueUploadTimeoutReplay');
  });

  it('binds the durable run before returning the accepted job', () => {
    const starter = source('src/lib/product-registration-authority/start-workflow.ts');
    const startIndex = starter.indexOf('const run = await start(productRegistrationV6Workflow');
    const bindIndex = starter.indexOf("input.supabase.rpc('bind_product_registration_v6_workflow_run'", startIndex);
    const returnIndex = starter.indexOf('return {', bindIndex);

    expect(startIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(startIndex);
    expect(returnIndex).toBeGreaterThan(bindIndex);
    expect(starter).toContain('await run.cancel().catch(() => undefined)');
  });

  it('resolves customer routes through catalog aliases and never through travel_packages', () => {
    const repository = source('src/lib/package-publication/repository.ts');
    const reader = repository.slice(
      repository.indexOf('export async function resolveCurrentPublicPackage'),
      repository.indexOf('export async function fetchLatestPublicPackageSnapshot'),
    );

    expect(reader).toContain('resolveCustomerRouteState');
    expect(reader).toContain('resolveCustomerRouteState');
    expect(reader).not.toContain(".from('travel_packages')");
  });

  it('persists tenant-bound snapshots and scopes pointer reads to the same catalog identity', () => {
    const snapshot = source('src/lib/product-registration-v6/snapshot-publication.ts');

    expect(snapshot).toContain('tenant_id: tenantId');
    expect(snapshot).toContain(".eq('tenant_id', input.snapshot.tenantId)");
    expect(snapshot).toContain(".eq('catalog_product_id', input.snapshot.catalogProductId)");
  });

  it('routes IR persistence through the Kernel and keeps preview non-persistent', () => {
    const irRoute = source('src/app/api/register-via-ir/route.ts');

    expect(irRoute).toContain('startProductRegistrationTextWorkflow');
    expect(irRoute).toContain('persisted: false');
    expect(irRoute).not.toContain(".from('travel_packages')");
    expect(irRoute).not.toContain(".from('normalized_intakes')");
  });

  it('retires every pre-Kernel publication RPC', () => {
    const retirement = source('supabase/migrations/20260816112624_retire_legacy_product_publication_rpcs.sql');
    const repository = source('src/lib/package-publication/repository.ts');
    const v5 = source('src/lib/product-registration-v4/publication.ts');

    for (const rpc of [
      'publish_package_snapshot_atomic',
      'publish_product_registration_v5_snapshot_atomic',
      'publish_product_registration_v6_snapshot_atomic',
    ]) expect(retirement).toContain(`drop function if exists public.${rpc}`);
    expect(repository).not.toContain('publish_' + 'package_snapshot_atomic');
    expect(v5).not.toContain('publish_product_registration_' + 'v5_snapshot_atomic');
  });

  it('does not enrich public detail prices or recommendations from mutable product facts', () => {
    const page = source('src/app/packages/[id]/page.tsx');
    const publicPage = page.slice(page.indexOf('export default async function PackageDetailPage'));

    expect(publicPage).not.toContain(".from('product_prices')");
    expect(publicPage).not.toContain('travel_packages!inner');
    expect(publicPage).toContain('listPublicCatalog');
  });

  it('persists explicit terminal outcomes for discard, archive, quarantine, and review', () => {
    const migration = source('supabase/migrations/20260816143544_product_registration_terminal_outcomes_v2_reassert_after_schema_reconciliation.sql');
    const workflow = source('src/workflows/product-registration-v6.ts');

    for (const outcome of [
      'ready_verified_not_published',
      'ready_degraded_not_published',
      'discarded_non_travel',
      'discarded_duplicate_or_consolidated',
      'archived_all_departures_past',
      'quarantined_unsupported_or_corrupt',
      'quarantined_system_failure',
    ]) {
      expect(migration).toContain(`'${outcome}'`);
      expect(workflow).toContain(`'${outcome}'`);
    }
    expect(workflow).toContain('unpublishedReadyDecision(copyDecision)');
  });

  it('creates an idempotent admin review alert for missing-sale and action-required outcomes', () => {
    const workflow = source('src/workflows/product-registration-v6.ts');
    const migration = source('supabase/migrations/20260817033000_product_registration_terminal_review_alerts.sql');

    expect(workflow).toContain("'enqueue_product_registration_review_alert'");
    expect(workflow).toContain("decision.terminalOutcome === 'discarded_source_incomplete'");
    expect(workflow).toContain("decision.terminalOutcome === 'blocked_action_required'");
    expect(migration).toContain('idx_upload_review_queue_pending_registration_job');
  });

  it('keeps route aliases private and exposes only service-role RPCs', () => {
    const migration = source('supabase/migrations/20260816112615_product_registration_catalog_route_aliases.sql');

    expect(migration).toContain('alter table internal_product_registration.public_route_aliases enable row level security');
    expect(migration).toContain('revoke all on table internal_product_registration.public_route_aliases from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.resolve_product_registration_public_route(uuid, text, text, text) to service_role');
    expect(migration).not.toContain('grant execute on function public.resolve_product_registration_public_route(uuid, text, text, text) to anon');
    expect(source('src/workflows/product-registration-v6.ts')).toContain("['customer', 'b2b', 'partner'] as const");
  });
});
