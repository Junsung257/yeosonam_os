import { describe, expect, it } from 'vitest';
import { buildBlogPublicSnapshotParityDiagnosticsV3 } from './blog-public-snapshot-parity-v3';

describe('blog public snapshot parity diagnostics', () => {
  it('reports missing, extra, and duplicate slugs instead of comparing counts only', () => {
    expect(buildBlogPublicSnapshotParityDiagnosticsV3({
      live: [{ slug: 'a' }, { slug: 'b' }, { slug: 'b' }],
      snapshot: [{ slug: 'a' }, { slug: 'c' }],
    })).toMatchObject({
      liveCount: 2,
      snapshotCount: 2,
      missingInSnapshot: ['b'],
      extraInSnapshot: ['c'],
      duplicateLiveSlugs: ['b'],
      parity: false,
    });
  });

  it('passes only equal unique slug sets', () => {
    expect(buildBlogPublicSnapshotParityDiagnosticsV3({
      live: [{ slug: 'b' }, { slug: 'a' }],
      snapshot: [{ slug: 'a' }, { slug: 'b' }],
    }).parity).toBe(true);
  });
});
