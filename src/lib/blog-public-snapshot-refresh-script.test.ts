import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(
  process.cwd(),
  'scripts/refresh-blog-public-snapshots.ts',
), 'utf8');

describe('blog public snapshot refresh script', () => {
  it('does not manufacture material modification dates from operational updated_at writes', () => {
    expect(script).toContain('row.content_modified_at ?? row.published_at');
    expect(script).not.toContain('row.content_modified_at ?? row.updated_at');
    expect(script).not.toContain('content_modified_at: row.updated_at || row.published_at');
  });

  it('writes only content-addressed immutable recovery artifacts after full slug parity', () => {
    expect(script).toContain("arg.startsWith('--artifact-dir=')");
    expect(script).toContain('immutable_detail_snapshot_parity_failed:');
    expect(script).toContain('catalogArtifactSha256}.json');
    expect(script).toContain('detailArtifactSha256}.json');
    expect(script).toContain("version: 'blog-public-snapshot-artifacts-v3'");
  });
});
