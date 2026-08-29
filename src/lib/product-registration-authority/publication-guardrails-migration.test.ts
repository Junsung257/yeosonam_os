import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260824074811_product_registration_publication_guardrails.sql',
), 'utf8');

describe('publication guardrails migration', () => {
  it('freezes broad publication and records exact publication requests', () => {
    expect(sql).toContain('set publication_freeze = true');
    expect(sql).toContain('add column if not exists catalog_product_id uuid');
    expect(sql).toContain('set catalog_product_id = package.catalog_product_id');
    expect(sql).toContain('create table if not exists internal_product_registration.publication_requests');
    expect(sql).toContain('expected_revision_no bigint not null');
    expect(sql).toContain('expected_source_hash text not null');
    expect(sql).toContain('expected_pointer_versions jsonb not null');
    expect(sql).toContain('REGISTRATION_PUBLICATION_IDEMPOTENCY_CONFLICT');
    expect(sql).toContain('on conflict (tenant_id, idempotency_key) do nothing');
  });

  it('fences customer reads and every published pointer to the latest revision', () => {
    expect(sql).toContain('create trigger trg_registration_pointer_latest_revision');
    expect(sql).toContain('REVISION_CHANGED_REVALIDATION_REQUIRED');
    expect(sql).toContain('join latest_revisions latest');
    expect(sql).toContain("and snapshot.status = 'published'");
    expect(sql).toContain("and proof_gate.status = 'passed'");
  });

  it('publishes channel pointers atomically and compensates convergence failure', () => {
    expect(sql).toContain('publish_product_registration_snapshot_bundle_atomic');
    expect(sql).toContain('REGISTRATION_PUBLICATION_BUNDLE_CHANNEL_INCOMPLETE');
    expect(sql).toContain("set state = 'convergence_failed'");
    expect(sql).toContain("customer_visibility_state = 'hidden'");
    expect(sql).toContain('package.publication.convergence_failed');
    expect(sql).toContain("pointer.state = 'convergence_failed'");
    expect(sql).toContain("'replayed', v_updated = 0 and v_already_failed > 0");
  });

  it('projects typed departure prices atomically with representative and date parity', () => {
    expect(sql).toContain("'authority', 'departure_instances'");
    expect(sql).toContain('delete from public.product_prices');
    expect(sql).toContain('insert into public.product_prices');
    expect(sql).toContain('PRICE_POLICY_CONFLICT');
    expect(sql).toContain('REGISTRATION_REPRESENTATIVE_PRICE_PARITY_FAILED');
    expect(sql).toContain('REGISTRATION_PRICE_DATE_PARITY_FAILED');
    expect(sql).toContain("'product_price_count', v_projected_price_count");
  });

  it('keeps admin truth private and uses invoker rights', () => {
    expect(sql).toContain('admin_package_publication_truth_v');
    expect(sql).toContain('with (security_invoker = true)');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('grant select on internal_product_registration.admin_package_publication_truth_v');
  });
});
