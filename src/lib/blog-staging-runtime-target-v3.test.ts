import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBlogStagingRuntimeTarget,
  BLOG_STAGING_RUNTIME_CONFIRMATION,
  extractSupabaseProjectRef,
  verifyBlogStagingBranchMetadata,
} from '../../scripts/lib/blog-staging-runtime-target-v3';

const STAGING_REF = 'abcdefghijklmnopqrst';
const PRODUCTION_REF = 'ixaxnvbmhzjvupissmly';

function validEnvironment(): Record<string, string> {
  return {
    BLOG_STAGING_RUNTIME_VERIFY_CONFIRM: BLOG_STAGING_RUNTIME_CONFIRMATION,
    BLOG_STAGING_SUPABASE_BRANCH_NAME: 'blog-quality-v3-rehearsal',
    BLOG_STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
    BLOG_PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
    SUPABASE_ACCESS_TOKEN: 'test-management-api-token',
    SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_ANON_KEY: 'test-anon-key',
  };
}

describe('blog staging runtime target guard', () => {
  it('accepts only an explicitly confirmed direct staging project URL', () => {
    expect(assertBlogStagingRuntimeTarget(validEnvironment())).toEqual({
      branchName: 'blog-quality-v3-rehearsal',
      productionProjectRef: PRODUCTION_REF,
      projectRef: STAGING_REF,
      url: `https://${STAGING_REF}.supabase.co`,
    });
    expect(extractSupabaseProjectRef(`https://${STAGING_REF}.supabase.co`)).toBe(STAGING_REF);
  });

  it('requires an explicit production ref and Management API token', () => {
    const {
      BLOG_PRODUCTION_SUPABASE_PROJECT_REF: _productionRef,
      ...withoutProductionRef
    } = validEnvironment();
    expect(() => assertBlogStagingRuntimeTarget(withoutProductionRef)).toThrow(
      'blog_staging_runtime_blog_production_supabase_project_ref_missing',
    );

    const { SUPABASE_ACCESS_TOKEN: _token, ...withoutToken } = validEnvironment();
    expect(() => assertBlogStagingRuntimeTarget(withoutToken)).toThrow(
      'blog_staging_runtime_supabase_access_token_missing',
    );
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

  it('proves the target is a non-default, data-free, non-persistent preview branch', async () => {
    const target = assertBlogStagingRuntimeTarget(validEnvironment());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      is_default: false,
      name: target.branchName,
      parent_project_ref: target.productionProjectRef,
      persistent: false,
      project_ref: target.projectRef,
      status: 'ACTIVE_HEALTHY',
      with_data: false,
    }), { status: 200 }));

    await expect(verifyBlogStagingBranchMetadata(
      target,
      validEnvironment(),
      fetchMock,
    )).resolves.toEqual({
      branchName: target.branchName,
      isDefault: false,
      parentProjectRef: target.productionProjectRef,
      persistent: false,
      projectRef: target.projectRef,
      status: 'ACTIVE_HEALTHY',
      withData: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/branches/blog-quality-v3-rehearsal`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-management-api-token',
        }),
        method: 'GET',
      }),
    );
  });

  it.each([
    ['is_default', true, 'blog_staging_runtime_default_branch_forbidden'],
    ['persistent', true, 'blog_staging_runtime_persistent_branch_forbidden'],
    ['with_data', true, 'blog_staging_runtime_data_clone_forbidden'],
    ['name', 'another-preview', 'blog_staging_runtime_branch_name_mismatch'],
    ['parent_project_ref', 'zyxwvutsrqponmlkjihg', 'blog_staging_runtime_branch_parent_ref_mismatch'],
    ['project_ref', 'zyxwvutsrqponmlkjihg', 'blog_staging_runtime_branch_project_ref_mismatch'],
  ])('rejects unsafe branch metadata: %s', async (field, value, expectedError) => {
    const target = assertBlogStagingRuntimeTarget(validEnvironment());
    const body = {
      is_default: false,
      name: target.branchName,
      parent_project_ref: target.productionProjectRef,
      persistent: false,
      project_ref: target.projectRef,
      with_data: false,
      [field]: value,
    };
    await expect(verifyBlogStagingBranchMetadata(
      target,
      validEnvironment(),
      async () => new Response(JSON.stringify(body), { status: 200 }),
    )).rejects.toThrow(expectedError);
  });

  it('rejects missing or malformed Management API proof without trusting its body', async () => {
    const target = assertBlogStagingRuntimeTarget(validEnvironment());
    await expect(verifyBlogStagingBranchMetadata(
      target,
      validEnvironment(),
      async () => new Response(JSON.stringify({ message: 'sensitive provider detail' }), {
        status: 403,
      }),
    )).rejects.toThrow('blog_staging_runtime_management_api_failed:403');
    await expect(verifyBlogStagingBranchMetadata(
      target,
      validEnvironment(),
      async () => new Response('not-json', { status: 200 }),
    )).rejects.toThrow('blog_staging_runtime_management_api_response_invalid');
  });

  it('runs branch proof before constructing a Supabase Data API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/verify-blog-staging-runtime-v3.ts'),
      'utf8',
    );
    expect(source.indexOf('await verifyBlogStagingBranchMetadata')).toBeGreaterThan(-1);
    expect(source.indexOf('await verifyBlogStagingBranchMetadata')).toBeLessThan(
      source.indexOf('createClient(target.url'),
    );
  });
});
