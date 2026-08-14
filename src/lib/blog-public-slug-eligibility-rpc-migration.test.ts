import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260814011000_blog_public_slug_eligibility_rpc.sql',
  'utf8',
).toLowerCase();
const rollback = readFileSync(
  'supabase/rollbacks/20260814011000_blog_public_slug_eligibility_rpc_rollback.sql',
  'utf8',
).toLowerCase();
const leastPrivilegeMigration = readFileSync(
  'supabase/migrations/20260814012500_blog_public_slug_eligibility_rpc_least_privilege.sql',
  'utf8',
).toLowerCase();
const leastPrivilegeRollback = readFileSync(
  'supabase/rollbacks/20260814012500_blog_public_slug_eligibility_rpc_least_privilege_rollback.sql',
  'utf8',
).toLowerCase();

describe('Blog Quality V3 public slug eligibility RPC migration', () => {
  it('exposes only a Boolean security-definer probe backed by the canonical view', () => {
    expect(migration).toContain('returns boolean');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public, pg_temp');
    expect(migration).toContain('from public.public_blog_content_creatives');
    expect(migration).toContain('grant execute on function public.is_blog_public_slug_eligible_v3(text) to anon, service_role');
    expect(migration).not.toContain('to anon, authenticated');
  });

  it('keeps the full eligibility view private', () => {
    expect(migration).toContain('revoke all on public.public_blog_content_creatives from public, anon, authenticated');
    expect(migration).not.toContain('grant select on public.public_blog_content_creatives to anon');
  });

  it('has an explicit function-only rollback', () => {
    expect(rollback).toContain('drop function if exists public.is_blog_public_slug_eligible_v3(text)');
  });

  it('removes the redundant authenticated SECURITY DEFINER grant with a reversible follow-up', () => {
    expect(leastPrivilegeMigration).toContain('revoke execute on function public.is_blog_public_slug_eligible_v3(text) from authenticated');
    expect(leastPrivilegeRollback).toContain('grant execute on function public.is_blog_public_slug_eligible_v3(text) to authenticated');
  });
});
