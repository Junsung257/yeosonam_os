import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260808143735_affiliate_settlement_ledger_v2.sql'),
  'utf8',
);

describe('affiliate settlement ledger V2 migration contract', () => {
  it('creates the append-only ledger, frozen lines, payout, revision and dispute records', () => {
    for (const table of [
      'commission_ledger_entries', 'settlement_runs', 'settlement_lines',
      'payouts', 'settlement_revisions', 'affiliate_disputes',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
    expect(migration).toContain('commission_ledger_entries_append_only_v2');
    expect(migration).toContain('settlement_lines_append_only_v2');
    expect(migration).toContain('COMPLETED_SETTLEMENT_IMMUTABLE');
    expect(migration).toContain('COMPLETED_PAYOUT_IMMUTABLE');
  });

  it('uses KST boundaries, a per-partner period lock and one frozen use per ledger entry', () => {
    expect(migration).toContain("make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'Asia/Seoul')");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('UNIQUE (affiliate_id, settlement_period)');
    expect(migration).toContain('UNIQUE (ledger_entry_id)');
    expect(migration).toContain('NOT EXISTS (SELECT 1 FROM public.settlement_lines');
  });

  it('fails closed without an approved settlement policy and does not seed one implicitly', () => {
    expect(migration).toContain("RAISE EXCEPTION 'SETTLEMENT_POLICY_MISSING'");
    expect(migration).toContain("v_policy.config->>'amount_scope' <> 'CUMULATIVE_UNSETTLED'");
    expect(migration).not.toContain('INSERT INTO public.policy_versions');
  });

  it('keeps legacy settlement rows read-only and corrections append-only', () => {
    expect(migration).toContain('LEGACY_SETTLEMENTS_READ_ONLY_USE_V2');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_commission_reversal_v2');
    expect(migration).toContain("'REVERSAL', -p_amount_krw");
    expect(migration).toContain('INSERT INTO public.settlement_revisions');
    expect(migration).not.toMatch(/UPDATE\s+public\.settlements\s+SET/i);
  });

  it('requires distinct payout requester and approver plus immutable evidence', () => {
    expect(migration).toContain('CONSTRAINT payouts_separation_chk CHECK (approved_by IS NULL OR approved_by <> requested_by)');
    expect(migration).toContain("RAISE EXCEPTION 'PAYOUT_SEPARATION_REQUIRED'");
    expect(migration).toContain("receipt_url ~ '^https://'");
    expect(migration).toContain("status = 'COMPLETED'");
  });
});
