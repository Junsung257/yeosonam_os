import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog snapshot artifact v4 verifier contract', () => {
  const script = readFileSync('scripts/verify-blog-snapshot-artifact-v4.ts', 'utf8');

  it('requires immutable schema, source commit, non-empty parity, and content hashes', () => {
    expect(script).toContain("manifest.version !== 'blog-public-snapshot-artifacts-v3'");
    expect(script).toContain('const schemaV4 = manifest.schema_version === 4');
    expect(script).toContain('schema_version_invalid_for_production');
    expect(script).toContain('source_commit_missing_or_invalid');
    expect(script).toContain('source_commit_mismatch');
    expect(script).toContain('source_ref_missing');
    expect(script).toContain('source_ref_mismatch');
    expect(script).toContain('catalog_detail_count_mismatch');
    expect(script).toContain('sha_mismatch');
    expect(script).toContain('snapshotRowCount');
  });

  it('rejects path traversal and empty artifact metadata', () => {
    expect(script).toContain('path_escape:');
    expect(script).toContain('positiveInteger(entry?.count');
    expect(script).toContain('positiveInteger(entry?.bytes');
  });

  it('accepts a complete production artifact and rejects source-ref drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'blog-snapshot-artifact-v4-'));
    const catalog = `${JSON.stringify({ posts: [{ slug: 'a' }] })}\n`;
    const detail = `${JSON.stringify({ posts: [{ slug: 'a' }] })}\n`;
    const writeArtifact = (relativePath: string, body: string) => {
      const path = join(root, relativePath);
      writeFileSync(path, body, 'utf8');
      return {
        relative_path: relativePath,
        sha256: createHash('sha256').update(body).digest('hex'),
        count: 1,
        bytes: Buffer.byteLength(body, 'utf8'),
      };
    };
    const manifestPath = join(root, 'manifest.json');
    const manifest = {
      version: 'blog-public-snapshot-artifacts-v3',
      schema_version: 4,
      generated_at: '2026-08-19T00:00:00.000Z',
      source_commit_sha: 'a'.repeat(40),
      source_git_ref: 'main',
      catalog: writeArtifact('catalog.json', catalog),
      detail: writeArtifact('detail.json', detail),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const cli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const args = [cli, 'scripts/verify-blog-snapshot-artifact-v4.ts', `--manifest=${manifestPath}`, `--expected-commit=${'a'.repeat(40)}`, '--expected-ref=main', '--require-source-commit'];
    expect(execFileSync(process.execPath, args, { encoding: 'utf8' })).toContain('"ok": true');
    const mismatchArgs = args.map((value) => value === '--expected-ref=main' ? '--expected-ref=release' : value);
    expect(() => execFileSync(process.execPath, mismatchArgs, { encoding: 'utf8', stdio: 'pipe' }))
      .toThrow(/source_ref_mismatch/);
  });
});
