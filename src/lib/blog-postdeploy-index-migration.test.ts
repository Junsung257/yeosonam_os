import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260814001600_blog_quality_v3_postdeploy_indexes.sql',
  'utf8',
).toLowerCase();
const rollback = readFileSync(
  'supabase/rollbacks/20260814001600_blog_quality_v3_postdeploy_indexes_rollback.sql',
  'utf8',
).toLowerCase();

describe('Blog Quality V3 post-deploy indexes', () => {
  it('covers the disposition creative foreign key without a lock-heavy build', () => {
    expect(migration).toContain('create index concurrently if not exists idx_blog_url_dispositions_creative');
    expect(migration).toContain('on public.blog_url_dispositions(creative_id)');
    expect(migration).not.toMatch(/^begin;/m);
  });

  it('has an explicit concurrent rollback', () => {
    expect(rollback).toContain('drop index concurrently if exists public.idx_blog_url_dispositions_creative');
  });
});
