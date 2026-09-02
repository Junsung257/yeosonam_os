import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260901114420_blog_autopilot_v4_truth_and_lifecycle.sql',
), 'utf8');

describe('blog autopilot V4 migration contract', () => {
  it('keeps provider evidence immutable and corrections append-only', () => {
    expect(migration).toContain('provider_raw_response jsonb');
    expect(migration).toContain('blog_indexing_classification_revisions');
    expect(migration).toContain('on conflict (indexing_report_id, classification_version) do nothing');
    expect(migration).toContain('grant select, insert on table public.blog_indexing_classification_revisions');
    expect(migration).not.toMatch(/update\s+public\.indexing_reports\s+set/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.indexing_reports/i);
  });

  it('creates only the finite D+1, D+3, and D+7 lifecycle', () => {
    expect(migration).toContain('milestone_days in (1, 3, 7)');
    expect(migration).toContain("attempt_count between 0 and 3");
    expect(migration).toContain("correction_type in ('technical', 'content')");
  });

  it('is service-role only and stores deployment provenance', () => {
    expect(migration).toContain('revoke all on table public.indexing_reports');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('pipeline_version');
    expect(migration).toContain('deployment_commit_sha');
    expect(migration).toContain('schema_migration_version');
  });
});
