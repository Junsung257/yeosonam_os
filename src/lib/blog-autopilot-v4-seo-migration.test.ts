import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION } from './blog-autopilot-v4-contract';

const migrationPath = 'supabase/migrations/20260901155821_blog_autopilot_v4_seo_completion.sql';
const migration = readFileSync(migrationPath, 'utf8');

describe('Blog Autopilot V4 SEO migration', () => {
  it('keeps the runtime version pinned to the additive migration', () => {
    expect(BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION).toBe('20260901155821');
  });

  it('creates append-only service-role SEO and adapter evidence tables', () => {
    for (const table of ['blog_seo_audit_runs', 'blog_seo_observations', 'blog_seo_audit_findings', 'blog_adapter_benchmarks']) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('revoke all on table');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toMatch(/grant\s+(?:all|delete|truncate)\b[^;]*blog_seo_observations/iu);
    expect(migration).toContain('benchmark_version text not null');
  });
});
