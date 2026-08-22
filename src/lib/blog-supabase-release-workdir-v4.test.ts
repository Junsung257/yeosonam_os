import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectBlogRemoteMigrationEvidenceV4,
  type BlogRemoteMigrationEvidenceV4,
} from '../../scripts/lib/blog-remote-migration-evidence-v4';
import {
  parseLinkedMigrationVersionsV4,
  prepareBlogSupabaseReleaseWorkdirV4,
} from '../../scripts/lib/blog-supabase-release-workdir-v4';

const PREVIEW_PROJECT_REF = 'aaaaaaaaaaaaaaaaaaaa';
const PRODUCTION_PROJECT_REF = 'bbbbbbbbbbbbbbbbbbbb';

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'blog-v4-release-workdir-'));
  const sourceRoot = process.cwd();
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase/release-manifests'), { recursive: true });
  mkdirSync(join(root, 'supabase/rollbacks'), { recursive: true });
  mkdirSync(join(root, 'supabase/.temp'), { recursive: true });
  writeFileSync(join(root, 'supabase/config.toml'), 'project_id = "fixture"\n', 'utf8');
  writeFileSync(join(root, 'supabase/.temp/project-ref'), PREVIEW_PROJECT_REF, 'utf8');

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

function collectEvidence(root: string, remoteVersions: string[]): BlogRemoteMigrationEvidenceV4 {
  return collectBlogRemoteMigrationEvidenceV4({
    expectedProjectRef: PREVIEW_PROJECT_REF,
    forbiddenProjectRef: PRODUCTION_PROJECT_REF,
    environment: 'preview',
    workdir: root,
    processEnv: {},
    runReadOnlyQuery: () => JSON.stringify({ rows: [{ evidence: { versions: remoteVersions } }] }),
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
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
      remoteEvidence: collectEvidence(root, ['20260101000000', alreadyAppliedRelease]),
    });
    const migrationDir = join(root, '.tmp/release/supabase/migrations');
    const files = readdirSync(migrationDir).sort();
    expect(summary.remoteAppliedCount).toBe(2);
    expect(summary.placeholderCount).toBe(1);
    expect(summary.pendingReleaseVersions).toHaveLength(12);
    expect(files).toHaveLength(14);
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
      remoteEvidence: collectEvidence(root, []),
    })).toThrow('blog_v4_release_workdir_must_be_under_tmp');
  });

  it('fails before the SELECT when the expected ref is missing or forbidden', () => {
    const root = fixtureRepository();
    let queryCalls = 0;
    const runReadOnlyQuery = () => {
      queryCalls += 1;
      return JSON.stringify({ rows: [{ evidence: { versions: [] } }] });
    };

    expect(() => collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: '',
      forbiddenProjectRef: PRODUCTION_PROJECT_REF,
      environment: 'preview',
      workdir: root,
      processEnv: {},
      runReadOnlyQuery,
    })).toThrow('blog_v4_expected_project_ref_invalid');
    expect(() => collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: PREVIEW_PROJECT_REF,
      forbiddenProjectRef: PREVIEW_PROJECT_REF,
      environment: 'preview',
      workdir: root,
      processEnv: {},
      runReadOnlyQuery,
    })).toThrow('blog_v4_expected_project_ref_forbidden');
    expect(queryCalls).toBe(0);
  });

  it('fails before the SELECT when the linked ref mismatches or production env is loaded', () => {
    const root = fixtureRepository();
    let queryCalls = 0;
    const runReadOnlyQuery = () => {
      queryCalls += 1;
      return JSON.stringify({ rows: [{ evidence: { versions: [] } }] });
    };

    expect(() => collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: PRODUCTION_PROJECT_REF,
      forbiddenProjectRef: 'cccccccccccccccccccc',
      environment: 'preview',
      workdir: root,
      processEnv: {},
      runReadOnlyQuery,
    })).toThrow('blog_v4_linked_project_ref_mismatch');
    expect(() => collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: PREVIEW_PROJECT_REF,
      forbiddenProjectRef: PRODUCTION_PROJECT_REF,
      environment: 'preview',
      workdir: root,
      processEnv: { NODE_ENV: 'production' },
      runReadOnlyQuery,
    })).toThrow('blog_v4_production_environment_loaded');
    expect(queryCalls).toBe(0);
  });

  it('allows the SELECT only after a verified preview link and writes hashed evidence', () => {
    const root = fixtureRepository();
    let queryCalls = 0;
    const evidence = collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: PREVIEW_PROJECT_REF,
      forbiddenProjectRef: PRODUCTION_PROJECT_REF,
      environment: 'preview',
      workdir: root,
      processEnv: {},
      runReadOnlyQuery: () => {
        queryCalls += 1;
        return JSON.stringify({ rows: [{ evidence: { versions: ['20260101000000'] } }] });
      },
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    expect(queryCalls).toBe(1);
    expect(evidence.linkedProjectRef).toBe(PREVIEW_PROJECT_REF);
    expect(readFileSync(join(root, 'remote-migration-evidence-v4.json'), 'utf8')).toContain('evidenceSha256');
  });

  it('keeps prepare local-only after evidence collection', () => {
    const root = fixtureRepository();
    let queryCalls = 0;
    const evidence = collectBlogRemoteMigrationEvidenceV4({
      expectedProjectRef: PREVIEW_PROJECT_REF,
      forbiddenProjectRef: PRODUCTION_PROJECT_REF,
      environment: 'preview',
      workdir: root,
      processEnv: {},
      runReadOnlyQuery: () => {
        queryCalls += 1;
        return JSON.stringify({ rows: [{ evidence: { versions: [] } }] });
      },
    });
    prepareBlogSupabaseReleaseWorkdirV4({ root, output: '.tmp/local-only', remoteEvidence: evidence });
    expect(queryCalls).toBe(1);
    const source = readFileSync(resolve(process.cwd(), 'scripts/prepare-blog-supabase-release-workdir-v4.ts'), 'utf8');
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('supabase db query');
  });
});
