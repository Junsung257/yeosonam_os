import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin tenant summary contract', () => {
  it('loads tenant cards with one aggregate endpoint instead of 2*N requests', () => {
    const page = readFileSync(new URL('../../admin/tenants/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('/api/tenants?include_stats=1&month=');
    expect(page).not.toContain('/api/tenant/products?tenant_id=');
    expect(page).not.toContain('/api/tenant/settlements?tenant_id=');
  });

  it('aggregates completed settlement costs on a KST calendar boundary', () => {
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/20260722225239_admin_tenant_summary.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('get_admin_tenant_summaries');
    expect(sql).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(sql).toContain("tx.status = 'COMPLETED'");
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('TO service_role');
  });
});
