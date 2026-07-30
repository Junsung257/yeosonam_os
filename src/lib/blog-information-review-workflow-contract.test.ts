import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog information review workflow contract', () => {
  const migration = source('supabase/migrations/20260715227000_blog_information_review_workflow.sql');
  const atomicMigration = source('supabase/migrations/20260715228000_blog_information_atomic_publication.sql');
  const replacementMigration = source('supabase/migrations/20260730113000_reviewed_blog_replacement.sql');
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

  it('replaces an approved high-risk draft without changing the public identity', () => {
    expect(replacementMigration).toContain('create table if not exists public.blog_information_replacements');
    expect(replacementMigration).toContain('replace_blog_information_reviewed_draft_atomically');
    expect(replacementMigration).toContain('perform pg_catalog.pg_advisory_xact_lock');
    expect(replacementMigration).toContain("v_draft.review_status <> 'approved'");
    expect(replacementMigration).toContain("v_target.status <> 'published'");
    expect(replacementMigration).toContain("'reviewed_published_replacement_v1'");
    expect(replacementMigration).toContain('blog_html = v_draft.blog_html');
    expect(replacementMigration).not.toContain('slug = v_draft.slug');
    expect(replacementMigration).toContain('published_at = coalesce(v_target.published_at, v_now)');
    expect(replacementMigration).toContain("set status = 'archived'");
    expect(replacementMigration).toContain('previous_snapshot jsonb not null');
    expect(replacementMigration).toContain("'blog_html', v_target.blog_html");
    expect(repository).toContain('replaceBlogInformationReviewedDraftAtomically({');
    expect(adminRoute).toContain('readReviewedPublishedBlogReplacement');
    expect(adminRoute).toContain('publishSlug = reviewedReplacement?.canonicalSlug');
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
      'verifiedAt:', 'expiresAt:', 'validatorReasons:', 'reviewedReplacement:',
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
    expect(replacementMigration).toContain('alter table public.blog_information_replacements enable row level security');
    expect(replacementMigration).toContain('security definer');
    expect(replacementMigration).toContain("set search_path = ''");
    expect(replacementMigration).not.toMatch(/grant .* to anon|grant .* to authenticated/i);
  });

  it('does not use product evidence or product snapshot tables', () => {
    expect(migration).not.toMatch(/travel_packages|package_publication|product_snapshot/);
    expect(repository).not.toMatch(/travel_packages|package_publication|product_snapshot/);
  });
});
