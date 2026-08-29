import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog generation dedup migration', () => {
  it('creates a service-role-only, expiring claim ledger without mutating legacy content', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260829093545_blog_generation_dedup_claims.sql'),
      'utf8',
    );
    expect(migration).toContain('create table if not exists public.blog_generation_dedup_claims');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on table public.blog_generation_dedup_claims from public, anon, authenticated');
    expect(migration).toContain('grant select, insert, update, delete on table public.blog_generation_dedup_claims to service_role');
    expect(migration).toContain('create or replace function public.claim_blog_generation_dedup');
    expect(migration).toContain('idx_blog_generation_dedup_claims_creative');
    expect(migration).toContain("or v_claim.expires_at <= now()");
    expect(migration).not.toMatch(/update\s+public\.content_creatives/iu);
    expect(migration).not.toMatch(/delete\s+from\s+public\.content_creatives/iu);
  });
});
