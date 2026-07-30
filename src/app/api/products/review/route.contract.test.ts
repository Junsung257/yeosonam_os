import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product review approval publication boundary', () => {
  it('approves the ERP product without bypassing the customer publication gate', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    const approvalStart = source.indexOf('async function handleApprove');
    const approvalEnd = source.indexOf('// ── 반려', approvalStart);
    const approval = source.slice(approvalStart, approvalEnd);

    expect(approval).toContain("supabaseAdmin.rpc('approve_reviewed_erp_product'");
    expect(approval).not.toContain(".from('travel_packages')\n    .update({ status: 'approved' })");
    expect(approval).toContain('고객 공개는 public snapshot');
  });

  it('keeps public package state unchanged and delegates publishing to the snapshot RPC', () => {
    const sql = readFileSync(
      new URL('../../../../../supabase/migrations/20260723123000_atomic_reviewed_product_approval.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("UPDATE public.products");
    expect(sql).not.toContain("UPDATE public.travel_packages");
    expect(sql).toContain("RAISE EXCEPTION 'review_product_not_found:%'");
    expect(sql).toContain("'customer_publication_state', 'unchanged'");
    expect(sql).toContain('publish_package_snapshot_atomic()');
    expect(sql).toContain('TO service_role');
  });
});
