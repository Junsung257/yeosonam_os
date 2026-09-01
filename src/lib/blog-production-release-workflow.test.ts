import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const path = '.github/workflows/blog-v4-production-release.yml';
const source = readFileSync(path, 'utf8');

describe('blog V4 protected production release workflow', () => {
  it('is valid YAML and is manual, serialized, and environment-protected', () => {
    const workflow = parse(source) as Record<string, unknown>;
    expect(workflow).toBeTruthy();
    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain('environment: blog-production');
    expect(source).toContain('cancel-in-progress: false');
  });

  it('pins the exact main SHA and proves the migration set before mutation', () => {
    expect(source).toContain('ref: main');
    expect(source).toContain('test "$(git rev-parse HEAD)" = "${{ inputs.release_commit }}"');
    expect(source).toContain('test "$(git rev-parse origin/main)" = "${{ inputs.release_commit }}"');
    const dryRun = source.indexOf('Prove exact Supabase dry-run set');
    const apply = source.indexOf('Apply pinned forward migrations');
    expect(dryRun).toBeGreaterThan(0);
    expect(dryRun).toBeLessThan(apply);
    expect(source).toContain('prepare:blog-supabase-release-workdir-v4');
    expect(source.match(/npx --yes supabase@2\.116\.0/g)?.length).toBe(3);
    expect(source.match(/--workdir \.tmp\/blog-v4-supabase-release/g)?.length).toBe(2);
    expect(source).toContain('verify:blog-supabase-dry-run-v4');
  });

  it('uses protected project variables and keeps the database password optional', () => {
    expect(source).toContain('secrets.VERCEL_ORG_ID || vars.VERCEL_ORG_ID');
    expect(source).toContain('secrets.VERCEL_PROJECT_ID || vars.VERCEL_PROJECT_ID');
    expect(source).toContain('secrets.SUPABASE_PROJECT_REF || vars.SUPABASE_PROJECT_REF');
    expect(source).toContain('secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL');
    expect(source).toContain('if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then');
    expect(source).not.toContain(
      'SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN',
    );
  });

  it('installs and audits the pinned evaluator before the editorial release gate', () => {
    const setup = source.indexOf('npm run setup:harness-evals');
    const audit = source.indexOf('npm run audit:harness-evals');
    const evaluate = source.indexOf('npm run eval:blog-editorial:offline');
    expect(setup).toBeGreaterThan(0);
    expect(setup).toBeLessThan(audit);
    expect(audit).toBeLessThan(evaluate);
  });

  it('verifies protected candidate URLs and fails closed around live promotion', () => {
    expect(source).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(source).toContain('SUPABASE_ACCESS_TOKEN');
    expect(source.match(/x-vercel-protection-bypass/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).toContain('update_env BLOG_AUTOPUBLISH_MODE draft_only');
    expect(source).toContain('update_env BLOG_GENERATION_CRON_ENABLED false');
    expect(source).toContain('if: failure() && inputs.promote_live');
    expect(source).toContain('production --value draft_only');
    expect(source).toContain('production --value false');
    expect(source).toContain('/blog/__blog_v4_missing_probe__');
    expect(source).toContain('test "$missing_status" = "404"');
    expect(source).toContain('verify:blog-release-candidate-responses-v4');
    expect(source).toContain('call_cron blog-ai-model-canary');
    expect(source).not.toContain('blog-data-readiness | tee .tmp/blog-v4-release/data-readiness.json || true');
  });
});
