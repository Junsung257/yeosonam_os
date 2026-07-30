import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('marketing LTV aggregate contract', () => {
  it('uses the all-row database aggregate instead of a client-side sample', () => {
    const route = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    expect(route).toContain("rpc('get_admin_marketing_ltv_summary'");
    expect(route).not.toContain('.limit(LTV_BOOKING_LIMIT)');
  });

  it('keeps the aggregate service-role only and RLS-aware', () => {
    const sql = readFileSync(
      new URL('../../../../../../supabase/migrations/20260722225812_admin_marketing_ltv_summary.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain("status IN ('deposit_paid', 'waiting_balance', 'fully_paid')");
    expect(sql).toContain('COALESCE(is_deleted, false) = false');
  });
});
