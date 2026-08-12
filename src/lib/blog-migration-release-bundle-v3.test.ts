import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyBlogMigrationReleaseBundleV3 } from '../../scripts/lib/blog-migration-release-bundle-v3';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function copyReleaseBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'blog-v3-release-'));
  temporaryDirectories.push(root);
  const bundle = verifyBlogMigrationReleaseBundleV3();
  const files = [
    bundle.manifestFile,
    ...bundle.migrations.map((entry) => entry.file),
    bundle.rollback.file,
  ];
  for (const file of files) {
    const destination = join(root, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(process.cwd(), file), destination);
  }
  return root;
}

describe('Blog Quality V3 migration release bundle', () => {
  it('pins the exact ordered five migrations and complete rollback', () => {
    const bundle = verifyBlogMigrationReleaseBundleV3();
    expect(bundle.migrations).toHaveLength(5);
    expect(bundle.migrations.map((entry) => entry.version)).toEqual([
      '20260811132017',
      '20260811132023',
      '20260811132031',
      '20260811132037',
      '20260811210920',
    ]);
    const rollback = readFileSync(join(process.cwd(), bundle.rollback.file), 'utf8');
    expect(rollback).toContain('drop trigger if exists trg_enqueue_generate_lead_analytics_event');
    expect(rollback).toContain('drop table if exists public.analytics_server_event_outbox;');
    expect(rollback).toContain('drop column if exists assisting_content_creative_id');
    expect(rollback).toContain('drop column if exists search_query_hash');

    const pgTap = readFileSync(
      join(process.cwd(), 'supabase/tests/blog_quality_v3_reliability.sql'),
      'utf8',
    );
    expect(pgTap).toContain('select plan(23);');
    expect(pgTap).toContain("'anon cannot execute privileged blog RPCs'");
    expect(pgTap).toContain("'service_role can execute every privileged blog RPC'");
    expect(pgTap).toContain("'public eligibility lane retains ordinal 51'");
    expect(pgTap).toContain("'public eligibility reason is appended at ordinal 60'");
  });

  it('fails closed when a reviewed migration changes after the manifest is signed', () => {
    const root = copyReleaseBundle();
    appendFileSync(
      join(root, 'supabase/migrations/20260811132037_blog_quality_v3_measurement.sql'),
      '\n-- unexpected drift\n',
    );
    expect(() => verifyBlogMigrationReleaseBundleV3(root)).toThrow(
      'blog_v3_release_sha256_mismatch',
    );
  });
});
