import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728203311_blog_regenerate_log_quality_gap_reason.sql',
  ),
  'utf8',
);

describe('blog regenerate log recovery reason migration', () => {
  it('accepts quality-gap locks and deduplicates all automatic recovery signals', () => {
    expect(migration).toContain("'quality_gap'");
    expect(migration).toContain('blog_regenerate_log_reason_check');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS blog_regenerate_log_automatic_daily_unique',
    );
    expect(migration).toContain("WHERE reason IN ('zero_click', 'quality_gap')");
  });
});
