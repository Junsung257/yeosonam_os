import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260813223117_blog_naver_first_serp_research_v3.sql';
const rollbackPath = 'supabase/rollbacks/20260813223117_blog_naver_first_serp_research_v3_rollback.sql';
const backfillPath = 'supabase/backfills/20260813223117_blog_naver_first_serp_research_v3_dry_run.sql';

describe('Naver-first SERP research migration contract', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
  const rollback = readFileSync(rollbackPath, 'utf8').toLowerCase();
  const backfill = readFileSync(backfillPath, 'utf8').toLowerCase();

  it.each([
    'blog_serp_research_runs',
    'blog_keyword_demand_observations',
    'blog_serp_page_observations',
  ])('keeps %s service-role only with RLS', (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    expect(sql).toContain(`on public.${table}`);
    expect(sql).toContain("to service_role");
  });

  it('stores provider metrics without conflating relative trend and volume', () => {
    expect(sql).toContain("value_kind text not null check (value_kind in ('observed', 'provider_estimate', 'relative_index'))");
    expect(sql).toContain("unit text not null check (unit in ('searches_per_month', 'relative_index_0_100', 'impressions_90d'))");
    expect(sql).toContain('datalab values remain relative indexes and are never converted to search volume');
  });

  it('has an explicit rollback for every new table and added column family', () => {
    expect(rollback).toContain('drop table if exists public.blog_serp_page_observations');
    expect(rollback).toContain('drop table if exists public.blog_keyword_demand_observations');
    expect(rollback).toContain('drop table if exists public.blog_serp_research_runs');
    expect(rollback).toContain('drop column if exists research_run_id');
    expect(rollback).toContain('drop column if exists analysis_version');
  });

  it('avoids an exclusive production index build and indexes every new foreign key', () => {
    expect(sql).not.toMatch(/^begin;/m);
    expect(sql).toContain('create index concurrently if not exists idx_serp_snapshots_research_run');
    expect(sql).toContain('idx_blog_keyword_demand_research_run');
    expect(sql).toContain('idx_blog_serp_observations_run_rank');
    expect(sql).toContain('idx_blog_serp_observations_snapshot');
  });

  it('keeps legacy backfill review read-only and defaults approved rows to zero', () => {
    expect(backfill).not.toMatch(/\b(insert|update|delete|merge|call|truncate)\s+(?:into\s+|from\s+|table\s+)?public\./);
    expect(backfill).toContain('0::bigint as approved_legacy_backfill_rows');
    expect(backfill).toContain("'fresh_research_required'::text as disposition");
  });
});
