import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260816015102_blog_ai_budget_and_gemini_rescue.sql',
  'utf8',
).toLowerCase();
const rollback = readFileSync(
  'supabase/rollbacks/20260816015102_blog_ai_budget_and_gemini_rescue_rollback.sql',
  'utf8',
).toLowerCase();

describe('blog AI budget and Gemini rescue migration', () => {
  it('uses an atomic day lock before checking and inserting reservations', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      migration.indexOf("insert into public.blog_ai_budget_reservations"),
    );
    expect(migration).toContain('daily_ai_cost_cap_reached');
    expect(migration).toContain('unique (queue_id, attempt_number)');
  });

  it('keeps the ledger and RPC service-role-only', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('grant execute on function public.reserve_blog_ai_budget_v4(uuid,integer,text,text,text,numeric,numeric,date)\n  to anon');
  });

  it('allows Gemini only for the final rescue stage', () => {
    expect(migration).toContain("provider = 'gemini'");
    expect(migration).toContain("stage = 'rescue_gemini'");
    expect(migration).toContain("provider = 'deepseek'");
  });

  it('has an explicit application rollback', () => {
    expect(rollback).toContain('drop table if exists public.blog_ai_budget_reservations');
    expect(rollback).toContain("check (provider = 'deepseek')");
  });
});
