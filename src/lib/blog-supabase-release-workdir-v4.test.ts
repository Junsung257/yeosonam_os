import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseLinkedMigrationVersionsV4,
  prepareBlogSupabaseReleaseWorkdirV4,
} from '../../scripts/lib/blog-supabase-release-workdir-v4';

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'blog-v4-release-workdir-'));
  const sourceRoot = process.cwd();
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase/release-manifests'), { recursive: true });
  mkdirSync(join(root, 'supabase/rollbacks'), { recursive: true });
  mkdirSync(join(root, 'supabase/.temp'), { recursive: true });
  writeFileSync(join(root, 'supabase/config.toml'), 'project_id = "fixture"\n', 'utf8');
  writeFileSync(join(root, 'supabase/.temp/project-ref'), 'fixture-ref', 'utf8');

  const manifestPath = join(sourceRoot, 'supabase/release-manifests/blog-orchestrator-v4-20260816.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    migrations: Array<{ file: string }>;
    rollback: { file: string };
  };
  cpSync(manifestPath, join(root, 'supabase/release-manifests/blog-orchestrator-v4-20260816.json'));
  for (const entry of [...manifest.migrations, manifest.rollback]) {
    const target = join(root, entry.file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(sourceRoot, entry.file), target);
  }
  return root;
}

describe('Blog V4 isolated Supabase release workdir', () => {
  it('parses and validates linked migration evidence', () => {
    expect(parseLinkedMigrationVersionsV4(JSON.stringify({
      rows: [{ evidence: { versions: ['20260101000000', '20260102000000'] } }],
    }))).toEqual(['20260101000000', '20260102000000']);
    expect(() => parseLinkedMigrationVersionsV4(JSON.stringify({
      rows: [{ evidence: { versions: ['not-a-version'] } }],
    }))).toThrow('blog_v4_remote_migration_version_invalid');
  });

  it('copies only applied placeholders and the exact pinned release set', () => {
    const root = fixtureRepository();
    const alreadyAppliedRelease = '20260606115000';
    const summary = prepareBlogSupabaseReleaseWorkdirV4({
      root,
      output: '.tmp/release',
      remoteVersions: ['20260101000000', alreadyAppliedRelease],
    });
    const migrationDir = join(root, '.tmp/release/supabase/migrations');
    const files = readdirSync(migrationDir).sort();
    expect(summary.remoteAppliedCount).toBe(2);
    expect(summary.placeholderCount).toBe(1);
    expect(summary.pendingReleaseVersions).toHaveLength(14);
    expect(summary.pendingReleaseVersions).toContain('20260901114420');
    expect(summary.pendingReleaseVersions).toContain('20260901155821');
    expect(files).toHaveLength(16);
    expect(files).toContain('20260101000000_remote_history_placeholder.sql');
    expect(files.filter((file) => file.startsWith(`${alreadyAppliedRelease}_`))).toHaveLength(1);
    expect(readFileSync(join(migrationDir, '20260101000000_remote_history_placeholder.sql'), 'utf8'))
      .toContain('already applied');
    expect(existsSync(join(root, '.tmp/release/supabase/.temp/project-ref'))).toBe(true);
    expect(existsSync(join(root, '.tmp/release/release-workdir-summary.json'))).toBe(true);
  });

  it('refuses to create or replace paths outside the repository .tmp directory', () => {
    const root = fixtureRepository();
    expect(() => prepareBlogSupabaseReleaseWorkdirV4({
      root,
      output: resolve(tmpdir(), `unsafe-${basename(root)}`),
      remoteVersions: [],
    })).toThrow('blog_v4_release_workdir_must_be_under_tmp');
  });
});
