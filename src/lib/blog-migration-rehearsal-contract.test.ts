import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'scripts/rehearse-blog-quality-v3-migrations.ts'), 'utf8');

describe('blog migration rehearsal safety', () => {
  it('only executes against an explicitly confirmed local ephemeral database', () => {
    expect(source).toContain("process.argv.includes('--local-reset')");
    expect(source).toContain("BLOG_LOCAL_MIGRATION_REHEARSAL_CONFIRM !== 'LOCAL_EPHEMERAL_DB'");
    expect(source).toContain("'db', 'reset', '--local', '--no-seed'");
    expect(source).toContain('assertDedicatedLocalRehearsalTarget(projectId)');
    expect(source).toContain('BLOG_LOCAL_MIGRATION_REHEARSAL_PROJECT_ID');
    expect(source).toContain("host !== '127.0.0.1'");
  });

  it('refuses the normal local project even when the generic confirmation is present', () => {
    expect(source).toContain('isDedicatedRehearsalProjectId(projectId)');
    expect(source).toContain('local_migration_rehearsal_requires_dedicated_project_id');
    expect(source).toContain("/(?:^|[-_])(rehearsal|ephemeral|scratch)(?:[-_]|$)/i");
  });

  it('rejects linked and arbitrary database targets', () => {
    expect(source).toContain("arg === '--linked'");
    expect(source).toContain("arg.startsWith('--db-url')");
    expect(source).not.toContain("'db', 'reset', '--linked'");
  });

  it('verifies the signed release bundle before offering reset commands', () => {
    expect(source).toContain('verifyBlogMigrationReleaseBundleV3()');
    expect(source.indexOf('verifyBlogMigrationReleaseBundleV3()')).toBeLessThan(
      source.indexOf("runSupabase(['db', 'reset'"),
    );
    expect(source).toContain('manifest: releaseBundle.manifestFile');
    expect(source).toContain('rollback: releaseBundle.rollback');
  });
});
