import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog information review workflow contract', () => {
  const migration = source('supabase/migrations/20260715227000_blog_information_review_workflow.sql');
  const atomicMigration = source('supabase/migrations/20260715228000_blog_information_atomic_publication.sql');
  const adminRoute = source('src/app/api/admin/blog/information-review/route.ts');
  const sharedReviewRoute = source('src/app/api/content-review/route.ts');
  const repository = source('src/lib/blog-information-review-repository.ts');
  const atomicPublisher = source('src/lib/blog-information-atomic-publication.ts');

  it('stores a durable case, an append-only audit trail, and an existing queue link', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.blog_information_review_cases');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.blog_information_review_events');
    expect(migration).toContain('information_review_case_id');
    expect(migration).toContain('blog_information_review_events_append_only');
    expect(repository).toContain("action: researchIsPersistable ? 'research_validated' : 'research_missing'");
  });

  it('publishes through a locked atomic function that rejects product content and changed snapshots', () => {
    expect(atomicMigration).toContain('publish_blog_information_atomically');
    expect(atomicMigration).toContain('FOR UPDATE');
    expect(atomicMigration).toContain('v_creative.product_id IS NOT NULL');
    expect(atomicMigration).toContain('information publication content changed');
    expect(atomicMigration).toContain("p_intent IN ('entry_requirements', 'travel_insurance')");
    expect(repository).toContain('publishBlogInformationAtomically({');
    expect(atomicPublisher).toContain("rpc('publish_blog_information_atomically'");
  });

  it('revalidates evidence at approval and again immediately before publish', () => {
    const calls = repository.match(/evaluateBlogInformationClaimPublishGate\(\{/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(repository).toContain('approvalValidation: true');
    expect(repository).toContain('blog_information_publish_revalidation_failed');
    expect(repository).toContain('blog_information_review_content_changed_reapproval_required');
  });

  it('makes storage and decision APIs admin-only and prevents the legacy approval bypass', () => {
    expect(adminRoute).toContain('withAdminGuard');
    expect(adminRoute).toContain('Product content is outside the informational review workflow');
    expect(adminRoute).toContain('prepareBlogForPublish');
    expect(sharedReviewRoute.indexOf('submitBlogInformationReviewDecision({'))
      .toBeLessThan(sharedReviewRoute.indexOf('await submitReview({'));
  });

  it('exposes claim, source, excerpt, scope, verification, expiry, and reasons to the review UI API', () => {
    for (const field of [
      'claim:', 'source:', 'sourceUrl:', 'excerpt:', 'scope:',
      'verifiedAt:', 'expiresAt:', 'validatorReasons:',
    ]) expect(repository).toContain(field);
    expect(adminRoute).toContain('getBlogInformationReviewQueue');
    expect(adminRoute).toContain("'Cache-Control': 'private, no-store'");
  });

  it('uses service-role-only RLS and fixed search paths for definer functions', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.blog_information_review_cases FROM public, anon, authenticated');
    expect(migration).toContain('REVOKE ALL ON TABLE public.blog_information_review_events FROM public, anon, authenticated');
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = ''/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.decide_blog_information_review');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.publish_blog_information_reviewed_draft');
    expect(migration).not.toMatch(/GRANT .* TO anon|GRANT .* TO authenticated/);
  });

  it('does not use product evidence or product snapshot tables', () => {
    expect(migration).not.toMatch(/travel_packages|package_publication|product_snapshot/);
    expect(repository).not.toMatch(/travel_packages|package_publication|product_snapshot/);
  });
});
