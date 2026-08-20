import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const releasePath = '.github/workflows/blog-v4-production-release.yml';
const activationPath = '.github/workflows/blog-v4-production-activation.yml';
const source = readFileSync(releasePath, 'utf8');
const activationSource = readFileSync(activationPath, 'utf8');

describe('blog V4 protected production release workflow', () => {
  it('is valid YAML and is manual, serialized, and environment-protected', () => {
    const workflow = parse(source) as Record<string, unknown>;
    expect(workflow).toBeTruthy();
    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain('environment: blog-production');
    expect(source).toContain('cancel-in-progress: false');
    expect((workflow.concurrency as { group?: string }).group).toBe('blog-v4-production-control');
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
    expect(source).toContain('verify:blog-snapshot-artifact-v4');
    expect(source).toContain('--require-source-commit');
    expect(source).toContain('VERCEL_GIT_COMMIT_REF: main');
    expect(source).toContain('VERCEL_GIT_COMMIT_SHA: ${{ inputs.release_commit }}');
    expect(source).toContain('--expected-ref=main');
    const snapshotVerify = source.indexOf('verify:blog-snapshot-artifact-v4');
    const snapshotApply = source.indexOf('refresh:blog-public-snapshots-v3 -- --apply-db');
    expect(snapshotVerify).toBeGreaterThan(0);
    expect(snapshotVerify).toBeLessThan(snapshotApply);
    expect(source.match(/--workdir \.tmp\/blog-v4-supabase-release/g)?.length).toBe(2);
    expect(source).toContain('verify:blog-supabase-dry-run-v4');
    expect(source).toContain('prepare:blog-content-factory-supabase-workdir-v4');
    expect(source).toContain('verify:blog-content-factory-supabase-dry-run-v4');
    expect(source).toContain('verify:blog-content-factory-release-bundle-v4');
  });

  it('keeps candidate deployment inert and fails closed around runtime evidence', () => {
    expect(source).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(source).toContain('SUPABASE_ACCESS_TOKEN');
    expect(source.match(/x-vercel-protection-bypass/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).toContain('update_env BLOG_AUTOPUBLISH_MODE draft_only');
    expect(source).toContain('update_env BLOG_GENERATION_CRON_ENABLED false');
    expect(source).toContain('update_env BLOG_CONTENT_FACTORY_ENABLED false');
    expect(source).toContain('update_env BLOG_AI_CONTROL_PLANE_ENABLED 0');
    expect(source).toContain('update_env BLOG_PRODUCTION_ALLOWED_GIT_REF main');
    expect(source).toContain('update_env BLOG_PRODUCTION_ALLOWED_COMMIT_SHA "${{ inputs.release_commit }}"');
    expect(source).not.toContain('promote_live');
    expect(source).toContain('update_env BLOG_DAILY_PUBLISH_CAP 1');
    expect(source).toContain('update_env BLOG_PUBLICATION_RAMP_STAGE pilot_3');
    expect(source).toContain('update_env BLOG_AUTO_RAMP_ENABLED false');
    expect(source).toContain('/blog/__blog_v4_missing_probe__');
    expect(source).toContain('test "$missing_status" = "404"');
    expect(source).toContain('verify:blog-release-candidate-responses-v4');
    expect(source).toContain('call_cron blog-ai-model-canary');
    expect(source).toContain('candidate-log-evidence.json');
    expect(source).toContain('"available":false');
    expect(source).toContain('"errorCount":null');
    expect(source).toContain('candidate-logs.jsonl ]; then');
    expect(source).not.toMatch(/vercel logs[^\n]*\|\| true/);
  });

  it('sets the allowed SHA before the deployment that can consume it', () => {
    const allowedSha = source.indexOf('update_env BLOG_PRODUCTION_ALLOWED_COMMIT_SHA "${{ inputs.release_commit }}"');
    const candidateDeploy = source.indexOf('name: Build and deploy unaliased production candidate');
    expect(allowedSha).toBeGreaterThan(0);
    expect(candidateDeploy).toBeGreaterThan(0);
    expect(allowedSha).toBeLessThan(candidateDeploy);
  });
});

describe('blog V4 explicit production activation workflow', () => {
  it('is manual, environment-protected, and has no one-step promote_live input', () => {
    const workflow = parse(activationSource) as Record<string, unknown>;
    expect(workflow).toBeTruthy();
    expect(activationSource).toContain('workflow_dispatch:');
    expect(activationSource).toContain('environment: blog-production');
    expect(activationSource).toContain('activation_stage:');
    for (const stage of ['draft_generation_canary', 'reviewed_canary', 'pilot_1', 'pilot_3', 'ramp_10', 'max_30']) {
      expect(activationSource).toContain(stage);
    }
    expect(activationSource).not.toContain('promote_live:');
    expect(activationSource).toContain('confirm_activation:');
    expect((workflow.concurrency as { group?: string }).group).toBe('blog-v4-production-control');
    const releaseWorkflow = parse(source) as Record<string, unknown>;
    expect((workflow.concurrency as { group?: string }).group)
      .toBe((releaseWorkflow.concurrency as { group?: string }).group);
  });

  it('always enables factory and control plane with generation', () => {
    expect(activationSource).toContain('test "$factory" = "true"');
    expect(activationSource).toContain('test "$control_plane" = "1"');
    expect(activationSource).toContain('update_env BLOG_CONTENT_FACTORY_ENABLED "${{ steps.contract.outputs.factory }}"');
    expect(activationSource).toContain('update_env BLOG_AI_CONTROL_PLANE_ENABLED "${{ steps.contract.outputs.control_plane }}"');
    expect(activationSource).toContain('BLOG_AI_CONTROL_PLANE_ENABLED 0');
    expect(activationSource).not.toMatch(/generation=true;[^\n]*factory=false/);
    expect(activationSource).not.toMatch(/generation=true;[^\n]*control_plane=0/);
  });

  it('starts live with bounded stages and keeps automatic ramp disabled', () => {
    expect(activationSource).toContain('mode=live; generation=true; factory=true; control_plane=1; cap=1; ramp=pilot_3;');
    expect(activationSource).toContain('mode=live; generation=true; factory=true; control_plane=1; cap=3; ramp=pilot_3;');
    expect(activationSource).toContain('mode=live; generation=true; factory=true; control_plane=1; cap=10; ramp=ramp_10;');
    expect(activationSource).toContain('mode=live; generation=true; factory=true; control_plane=1; cap=30; ramp=max_30;');
    expect(activationSource).toContain('update_env BLOG_AUTO_RAMP_ENABLED false');
    expect(activationSource).toContain('max_30 requires approvedForSlotCount >= 60');
  });

  it('restores every inert safety flag after activation failure', () => {
    expect(activationSource).toContain('update_env BLOG_AUTOPUBLISH_MODE draft_only');
    expect(activationSource).toContain('update_env BLOG_GENERATION_CRON_ENABLED false');
    expect(activationSource).toContain('update_env BLOG_CONTENT_FACTORY_ENABLED false');
    expect(activationSource).toContain('update_env BLOG_AI_CONTROL_PLANE_ENABLED 0');
    expect(activationSource).toContain('update_env BLOG_DAILY_PUBLISH_CAP 1');
    expect(activationSource).toContain('update_env BLOG_PUBLICATION_RAMP_STAGE pilot_3');
    expect(activationSource).toContain('update_env BLOG_AUTO_RAMP_ENABLED false');
    expect(activationSource).not.toMatch(/vercel logs[^\n]*\|\| true/);
    expect(activationSource).toContain('"available":false');
    expect(activationSource).toContain('"errorCount":null');
    expect(activationSource).toContain('activation-production-logs.jsonl ]; then');
    expect(activationSource).toContain('steps.activation_mutation.outputs.started == \'true\'');
    expect(activationSource).toContain('Redeploy and promote verified inert runtime after activation failure');
    expect(activationSource).toContain('ACTIVATION_FAILED_ROLLBACK_SUCCEEDED');
    expect(activationSource).toContain('ACTIVATION_FAILED_ROLLBACK_FAILED');
    const reset = activationSource.indexOf('update_env BLOG_AUTOPUBLISH_MODE draft_only || exit 1');
    const safeDeploy = activationSource.indexOf('safe_url="$(npx vercel deploy --prod --skip-domain');
    const safeVerify = activationSource.indexOf('inert candidate contract failed');
    const safePromote = activationSource.indexOf('npx vercel promote "$safe_url"');
    const publicVerify = activationSource.indexOf('inert production contract failed');
    expect(reset).toBeGreaterThan(0);
    expect(reset).toBeLessThan(safeDeploy);
    expect(safeDeploy).toBeLessThan(safeVerify);
    expect(safeVerify).toBeLessThan(safePromote);
    expect(safePromote).toBeLessThan(publicVerify);
  });
});
