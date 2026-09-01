import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260901082833_product_registration_customer_read_boundary.sql',
), 'utf8');

describe('product registration customer read boundary migration', () => {
  it('restores the mandatory publication freeze without mutating pointers', () => {
    expect(migration).toContain('set publication_freeze = true');
    expect(migration).not.toMatch(/update\s+public\.product_registration_v5_publication_pointers/iu);
    expect(migration).not.toMatch(/delete\s+from\s+public\.product_registration_v5_publication_pointers/iu);
  });

  it('exposes only minimal service-role RPCs', () => {
    expect(migration).toContain('get_product_registration_customer_route_state');
    expect(migration).toContain('get_qualified_product_registration_supplier_profile');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain("'snapshot_json'");
    expect(migration).not.toContain("'snapshot_hash'");
  });

  it('requires exact tenant, pointer, revision and snapshot lineage', () => {
    expect(migration).toContain('pointer.tenant_id = p_tenant_id');
    expect(migration).toContain('snapshot.canonical_revision_id = v_pointer.current_revision_id');
    expect(migration).toContain("revision.status in ('verified', 'approved', 'published')");
    expect(migration).toContain("coalesce(v_sale_state, 'available') in ('closed', 'sold_out', 'suspended')");
  });
});
