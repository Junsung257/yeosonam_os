import { describe, expect, it } from 'vitest';
import { verifyBlogContentFactoryV4ReleaseBundle } from '../../scripts/lib/blog-content-factory-v4-release-bundle';

describe('Blog V4 content factory release bundle', () => {
  it('pins the additive migration and guarded rollback by exact hash', () => {
    const bundle = verifyBlogContentFactoryV4ReleaseBundle();
    expect(bundle.applyMode).toBe('supabase-db-push-exact-dry-run-required');
    expect(bundle.migrations.map((entry) => entry.version)).toEqual(['20260819073009', '20260820100000', '20260820113000']);
    expect(bundle.migrations[0]?.bytes).toBeGreaterThan(40_000);
    expect(bundle.rollback.bytes).toBeGreaterThan(1_000);
  });
});
