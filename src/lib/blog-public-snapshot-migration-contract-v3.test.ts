import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260811132031_blog_quality_v3_snapshots_media.sql',
), 'utf8');

describe('Blog Quality V3 snapshot migration contract', () => {
  it('keeps the service-role refresh RPC compatible with safe-update enforcement', () => {
    expect(migration).toContain('refresh_blog_public_snapshots_v3');
    expect(migration).toContain('delete from public.blog_public_catalog_facets\n  where facet_type is not null;');
    expect(migration).not.toMatch(/delete from public\.blog_public_catalog_facets\s*;/i);
    expect(migration).toContain(
      'revoke all on function public.refresh_blog_public_snapshots_v3() from public, anon, authenticated;',
    );
  });
});
