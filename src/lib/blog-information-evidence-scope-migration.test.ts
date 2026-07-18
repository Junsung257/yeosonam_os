import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog information evidence scope migration', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260715225000_blog_information_evidence_scope.sql',
  ), 'utf8');

  it('adds an additive JSON object scope without touching product evidence', () => {
    expect(migration).toContain('ALTER TABLE public.blog_information_evidence');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("CHECK (jsonb_typeof(scope) = 'object')");
    expect(migration).not.toMatch(/travel_packages|product_snapshot|package_publication/);
  });
});
