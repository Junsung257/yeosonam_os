import { readFileSync } from 'node:fs';
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
});
