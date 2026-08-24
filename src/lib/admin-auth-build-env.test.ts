import { describe, expect, it } from 'vitest';
import { validateAdminAuthBuildEnv } from '../../scripts/verify-admin-auth-build-env.mjs';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  ADMIN_EMAILS: 'admin@example.com',
};

describe('admin auth production build environment', () => {
  it('accepts the current Supabase publishable key contract', () => {
    expect(validateAdminAuthBuildEnv(baseEnv)).toEqual({ ok: true, issues: [] });
  });

  it('keeps the legacy anon key as a migration fallback', () => {
    expect(validateAdminAuthBuildEnv({
      ...baseEnv,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon-key',
    })).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ['Supabase URL', { ...baseEnv, NEXT_PUBLIC_SUPABASE_URL: '' }],
    ['public key', { ...baseEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }],
    ['admin allowlist', { ...baseEnv, ADMIN_EMAILS: '' }],
  ])('blocks production when %s is missing', (_label, env) => {
    const result = validateAdminAuthBuildEnv(env);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects a non-HTTPS project URL', () => {
    const result = validateAdminAuthBuildEnv({
      ...baseEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'http://project-ref.supabase.co',
    });
    expect(result).toEqual({
      ok: false,
      issues: ['NEXT_PUBLIC_SUPABASE_URL must use https'],
    });
  });
});
