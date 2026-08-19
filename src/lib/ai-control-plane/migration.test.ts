import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260819113000_ai_control_plane_v1.sql'), 'utf8');
const rollback = readFileSync(resolve(process.cwd(), 'supabase/rollbacks/ai-control-plane-v1-20260819.sql'), 'utf8');

describe('AI control plane migration contract', () => {
  it('creates private budget/receipt ledgers and atomic RPCs', () => {
    expect(migration).toContain('create table if not exists public.ai_budget_buckets');
    expect(migration).toContain('create table if not exists public.ai_call_reservations');
    expect(migration).toContain('create table if not exists public.ai_call_receipts');
    expect(migration).toContain('create or replace function public.reserve_ai_budget_v1');
    expect(migration).toContain('create or replace function public.settle_ai_budget_v1');
    expect(migration).toContain("p_provider <> 'deepseek'");
    expect(migration).toContain('candidate_model_call_cap');
    expect(migration).toContain("r.status in ('reserved', 'completed', 'failed')");
    expect(migration).toContain("'pro_daily_call_cap'");
    expect(migration).toContain('revoke all on table public.ai_call_receipts from anon, authenticated');
  });

  it('rollback removes functions before tables', () => {
    expect(rollback.indexOf('drop function if exists public.settle_ai_budget_v1')).toBeLessThan(rollback.indexOf('drop table if exists public.ai_call_receipts'));
    expect(rollback).toContain('drop table if exists public.ai_call_reservations');
  });
});
