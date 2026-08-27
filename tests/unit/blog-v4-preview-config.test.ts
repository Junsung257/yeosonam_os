import { describe, expect, it } from 'vitest';

import { resolvePreviewSupabaseTarget } from '../../scripts/lib/blog-v4-preview-config.mjs';

const STAGING_REF = 'abcdefghijklmnopqrst';
const PRODUCTION_REF = 'zyxwvutsrqponmlkjihg';

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    BLOG_STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
    BLOG_PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
    BLOG_STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    ...overrides,
  };
}

describe('Blog V4 Preview Supabase target', () => {
  it('resolves only the explicit non-production staging target', () => {
    expect(resolvePreviewSupabaseTarget(environment())).toEqual({
      projectRef: STAGING_REF,
      productionProjectRef: PRODUCTION_REF,
      url: `https://${STAGING_REF}.supabase.co`,
    });
  });

  it('rejects a Preview target that equals Production', () => {
    expect(() => resolvePreviewSupabaseTarget(environment({
      BLOG_STAGING_SUPABASE_PROJECT_REF: PRODUCTION_REF,
      BLOG_STAGING_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    }))).toThrow('blog_preview_production_supabase_ref_forbidden');
  });

  it('rejects a URL whose host does not match the staging ref', () => {
    expect(() => resolvePreviewSupabaseTarget(environment({
      BLOG_STAGING_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    }))).toThrow('blog_preview_staging_supabase_target_mismatch');
  });

  it('rejects a URL with a path or query that is not the project origin', () => {
    expect(() => resolvePreviewSupabaseTarget(environment({
      BLOG_STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co/rest/v1`,
    }))).toThrow('blog_preview_staging_supabase_target_mismatch');
  });

  it('does not fall back to generic production-shaped variables', () => {
    expect(() => resolvePreviewSupabaseTarget({
      SUPABASE_PROJECT_REF: STAGING_REF,
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    })).toThrow('missing_BLOG_STAGING_SUPABASE_PROJECT_REF');
  });

  it('keeps the Preview configurator contract scoped to staging-only secrets', async () => {
    const source = await import('node:fs/promises');
    const script = await source.readFile(
      new URL('../../scripts/configure-vercel-blog-v4-preview.mjs', import.meta.url),
      'utf8',
    );

    expect(script).toContain('BLOG_STAGING_SUPABASE_SERVICE_ROLE_KEY');
    expect(script).toContain('BLOG_STAGING_CRON_SECRET');
    expect(script).not.toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(script).not.toContain("process.env.CRON_SECRET");
  });

  it('verifies Branch metadata without opening a Data API client or mutating snapshots', async () => {
    const source = await import('node:fs/promises');
    const verifier = await source.readFile(
      new URL('../../scripts/verify-blog-v4-preview-target.ts', import.meta.url),
      'utf8',
    );
    const workflow = await source.readFile(
      new URL('../../.github/workflows/blog-v4-preview-config.yml', import.meta.url),
      'utf8',
    );

    expect(verifier).toContain('verifyBlogStagingBranchMetadata');
    expect(verifier).toContain('dataApiCalls: 0');
    expect(verifier).toContain('snapshotMutations: 0');
    expect(verifier).not.toContain('createClient');
    expect(verifier).not.toContain('.rpc(');
    expect(workflow).toContain('verify-blog-v4-preview-target.ts');
    expect(workflow).toContain('BLOG_STAGING_SUPABASE_ACCESS_TOKEN');
  });
});
