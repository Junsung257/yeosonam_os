import { describe, expect, it } from 'vitest';
import { verifyBlogOrchestratorV4ReleaseBundle } from '../../scripts/lib/blog-orchestrator-v4-release-bundle';

describe('blog orchestrator V4 release bundle', () => {
  it('pins every production gap and the emergency rollback by hash', () => {
    const bundle = verifyBlogOrchestratorV4ReleaseBundle();
    expect(bundle.applyMode).toBe('supabase-db-push-include-all-after-exact-dry-run');
    expect(bundle.migrations).toHaveLength(9);
    expect(bundle.migrations.map((entry) => entry.version)).toContain('20260606115000');
    expect(bundle.migrations.map((entry) => entry.version)).toContain('20260816120000');
    expect(bundle.migrations.map((entry) => entry.version)).toContain('20260816123000');
    expect(bundle.rollback.bytes).toBeGreaterThan(1000);
  });
});
