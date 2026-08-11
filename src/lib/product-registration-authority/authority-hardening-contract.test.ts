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

  it('backfills through one shadow workflow and heals a lost follow-up bind', () => {
    const route = source('src/app/api/cron/product-registration-v6-backfill/route.ts');
    const migration = source('supabase/migrations/20260811121526_product_registration_legacy_backfill_ledger.sql');
    expect(route).toContain('startProductRegistrationTextWorkflow');
    expect(route).toContain('archiveMode: true');
    expect(route).toContain("bindingKind: 'legacy_backfill'");
    expect(route).not.toContain(".from('travel_packages').insert");
    expect(migration).toContain("j.v4_stage_state->>'authorityBindingOperationKey'");
    expect(migration).toContain("'legacy-backfill:' || b.id::text");
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
});
