import { describe, expect, it } from 'vitest';
import {
  assertBlogStagingRuntimeTarget,
  BLOG_STAGING_RUNTIME_CONFIRMATION,
  extractSupabaseProjectRef,
} from '../../scripts/lib/blog-staging-runtime-target-v3';

const STAGING_REF = 'abcdefghijklmnopqrst';
const PRODUCTION_REF = 'ixaxnvbmhzjvupissmly';

function validEnvironment(): Record<string, string> {
  return {
    BLOG_STAGING_RUNTIME_VERIFY_CONFIRM: BLOG_STAGING_RUNTIME_CONFIRMATION,
    BLOG_STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
    BLOG_PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
    SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_ANON_KEY: 'test-anon-key',
  };
}

describe('blog staging runtime target guard', () => {
  it('accepts only an explicitly confirmed direct staging project URL', () => {
    expect(assertBlogStagingRuntimeTarget(validEnvironment())).toEqual({
      projectRef: STAGING_REF,
      url: `https://${STAGING_REF}.supabase.co`,
    });
    expect(extractSupabaseProjectRef(`https://${STAGING_REF}.supabase.co`)).toBe(STAGING_REF);
  });

  it('rejects the production project even with the mutation confirmation', () => {
    expect(() => assertBlogStagingRuntimeTarget({
      ...validEnvironment(),
      BLOG_STAGING_SUPABASE_PROJECT_REF: PRODUCTION_REF,
      SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    })).toThrow('blog_staging_runtime_production_project_forbidden');
  });

  it('rejects missing confirmation and mismatched project refs', () => {
    expect(() => assertBlogStagingRuntimeTarget({
      ...validEnvironment(),
      BLOG_STAGING_RUNTIME_VERIFY_CONFIRM: '',
    })).toThrow('blog_staging_runtime_confirmation_missing');
    expect(() => assertBlogStagingRuntimeTarget({
      ...validEnvironment(),
      SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co',
    })).toThrow('blog_staging_runtime_project_ref_mismatch');
  });

  it('does not fall back to a public client URL or accept a non-origin URL', () => {
    const { SUPABASE_URL: _omitted, ...withoutServerUrl } = validEnvironment();
    expect(() => assertBlogStagingRuntimeTarget({
      ...withoutServerUrl,
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    })).toThrow('blog_staging_runtime_supabase_url_missing');
    expect(() => extractSupabaseProjectRef(
      `https://${STAGING_REF}.supabase.co/rest/v1`,
    )).toThrow('blog_staging_runtime_supabase_url_not_direct_project_origin');
  });
});
