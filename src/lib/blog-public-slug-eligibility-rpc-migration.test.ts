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
const appRouterContractMigration = readFileSync(
  'supabase/migrations/20260815211325_blog_public_eligibility_rpc_contract.sql',
  'utf8',
).toLowerCase();
const appRouterContractRollback = readFileSync(
  'supabase/rollbacks/20260815211325_blog_public_eligibility_rpc_contract_rollback.sql',
  'utf8',
).toLowerCase();
const publicRegistryMigration = readFileSync(
  'supabase/migrations/20260816123000_blog_public_slug_registry_v1.sql',
  'utf8',
).toLowerCase();
const publicRegistryRollback = readFileSync(
  'supabase/rollbacks/20260816123000_blog_public_slug_registry_v1_rollback.sql',
  'utf8',
).toLowerCase();
const publicRegistrySecurityRepair = readFileSync(
  'supabase/migrations/20260816124500_blog_public_slug_registry_security_definer.sql',
  'utf8',
).toLowerCase();
const publicRegistrySecurityRepairRollback = readFileSync(
  'supabase/rollbacks/20260816124500_blog_public_slug_registry_security_definer_rollback.sql',
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

  it('retires the anonymous policy oracle after the App Router takes ownership', () => {
    expect(appRouterContractMigration).toContain(
      'drop function if exists public.is_blog_public_slug_eligible_v3(text)',
    );
    expect(appRouterContractMigration).toContain(
      'revoke all on table public.public_blog_content_creatives',
    );
    expect(appRouterContractMigration).toContain(
      'grant select on table public.public_blog_content_creatives to service_role',
    );
    expect(appRouterContractMigration).not.toContain('grant execute');
  });

  it('documents a reversible emergency rollback without exposing article rows', () => {
    expect(appRouterContractRollback).toContain('returns boolean');
    expect(appRouterContractRollback).toContain('to anon, service_role');
    expect(appRouterContractRollback).not.toContain(
      'grant select on table public.public_blog_content_creatives to anon',
    );
  });

  it('exposes only the canonical public id/slug projection needed for a hard 404', () => {
    expect(publicRegistryMigration).toContain('with (security_barrier = true)');
    expect(publicRegistryMigration).toContain('from public.public_blog_content_creatives');
    expect(publicRegistryMigration).toContain('select id, slug');
    expect(publicRegistryMigration).toContain('grant select on table public.public_blog_slug_registry to anon');
    expect(publicRegistryMigration).not.toContain('generation_meta');
    expect(publicRegistryMigration).not.toContain('review_status');
    expect(publicRegistryRollback).toContain('drop view if exists public.public_blog_slug_registry');
  });

  it('repairs the registry through an id/slug-only security-definer projection', () => {
    expect(publicRegistrySecurityRepair).toContain(
      'create or replace function public.list_public_blog_slug_registry_v1()',
    );
    expect(publicRegistrySecurityRepair).toContain('returns table(id uuid, slug text)');
    expect(publicRegistrySecurityRepair).toContain('security definer');
    expect(publicRegistrySecurityRepair).toContain('set search_path = public, pg_temp');
    expect(publicRegistrySecurityRepair).toContain('from public.public_blog_content_creatives eligible');
    expect(publicRegistrySecurityRepair).toContain(
      'grant execute on function public.list_public_blog_slug_registry_v1()',
    );
    expect(publicRegistrySecurityRepair).toContain('select id, slug');
    expect(publicRegistrySecurityRepair).not.toContain('generation_meta');
    expect(publicRegistrySecurityRepair).not.toContain('review_status');
    expect(publicRegistrySecurityRepairRollback).toContain(
      'drop function if exists public.list_public_blog_slug_registry_v1()',
    );
  });
});
