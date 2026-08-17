import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260815120135_blog_deepseek_orchestrator_v4.sql',
  'utf8',
).toLowerCase();
const repairMigration = readFileSync(
  'supabase/migrations/20260818080000_blog_deepseek_auto_repair_budget_v1.sql',
  'utf8',
).toLowerCase();

describe('blog DeepSeek orchestrator V4 migration contract', () => {
  it('creates durable run, attempt and effective-dated price tables', () => {
    expect(migration).toContain('create table if not exists public.blog_generation_runs');
    expect(migration).toContain('create table if not exists public.blog_generation_attempts');
    expect(migration).toContain('create table if not exists public.ai_model_price_catalog');
    expect(migration).toContain('attempt_count between 0 and 3');
    expect(migration).toContain("'approved_for_slot'");
    expect(migration).toContain("conname = 'blog_generation_runs_selected_attempt_fk'");
    expect(migration).toContain('idx_blog_generation_runs_created_at');
    expect(migration).toContain('idx_blog_generation_runs_creative');
    expect(migration).toContain('idx_blog_generation_runs_selected_attempt');
  });

  it('keeps all orchestration evidence service-role only', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('blog_generation_runs_service_role_all');
    expect(migration).toContain('blog_generation_attempts_service_role_all');
    expect(migration).not.toMatch(/grant\s+select[^;]+to\s+(?:anon|authenticated)/s);
  });

  it('contains no historical content update and documents dry-run backfill and rollback', () => {
    expect(migration).not.toMatch(/update\s+public\.content_creatives/);
    expect(migration).toContain('backfill dry-run');
    expect(migration).toContain('rollback (run manually only after application rollback)');
  });

  it('raises only the durable repair budget and keeps the budget RPC DeepSeek-only', () => {
    expect(repairMigration).toContain('attempt_count between 0 and 5');
    expect(repairMigration).toContain('attempt_number between 1 and 5');
    expect(repairMigration).toContain('p_attempt_number not between 1 and 5');
    expect(repairMigration).toContain("p_provider <> 'deepseek'");
    expect(repairMigration).toContain('rollback');
    expect(repairMigration).not.toMatch(/update\s+public\.content_creatives/);
  });
});
