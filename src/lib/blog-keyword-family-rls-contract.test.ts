import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260815093943_blog_keyword_families_service_role_rls.sql',
  ),
  'utf8',
);

describe('blog keyword-family RLS contract', () => {
  it('removes browser-role access and allows only the service role', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('FOR ALL TO service_role');
    expect(migration).not.toContain('CREATE POLICY "allow_all_blog_keyword_families"');
  });
});
