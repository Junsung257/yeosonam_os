import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBlogInformationRepresentativeKey,
  buildBlogInformationDuplicateDryRun,
  calculateBlogInformationSimilarity,
  decideBlogInformationDuplicate,
  isCanonicalInformationSitemapPost,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationDuplicateCandidate,
  type BlogInformationRepresentativeRecord,
} from './blog-information-representative';

const candidate: BlogInformationDuplicateCandidate = {
  destinationId: 'sapporo',
  intent: 'food_budget',
  audience: 'general',
  locale: 'ko-KR',
  slug: 'sapporo-food-budget-2026',
  title: '2026 삿포로 식비 가이드',
  markdown: '삿포로 여행의 메뉴별 식비와 하루 예산을 정리합니다.',
};

const active: BlogInformationRepresentativeRecord = {
  representativeKey: 'v1|sapporo|food_budget|general|ko-KR',
  destinationId: 'sapporo',
  intent: 'food_budget',
  audience: 'general',
  locale: 'ko-KR',
  canonicalCreativeId: 'creative-1',
  canonicalSlug: 'sapporo-food-budget',
  status: 'active',
  reservationOwner: 'queue-old',
};

describe('blog information representative key and duplicate decisions', () => {
  it('uses destination + intent + audience + locale and ignores year-only title changes', () => {
    const first = buildBlogInformationRepresentativeKey(candidate);
    const nextYearCandidate: BlogInformationDuplicateCandidate = {
      ...candidate,
      slug: 'sapporo-food-budget-2027',
      title: '2027 삿포로 식비 가이드',
    };
    const nextYear = buildBlogInformationRepresentativeKey(nextYearCandidate);
    expect(first).toBe('v1|sapporo|food_budget|general|ko-KR');
    expect(nextYear).toBe(first);
  });

  it('proposes updating the canonical article instead of creating another URL', () => {
    const decision = decideBlogInformationDuplicate({
      candidate,
      existing: active,
      reservationOwner: 'queue-new',
      existingTitle: '2025 삿포로 식비 가이드',
      existingMarkdown: candidate.markdown,
    });
    expect(decision.action).toBe('UPDATE_EXISTING');
    expect(decision.canonicalSlug).toBe('sapporo-food-budget');
    expect(decision.exactDuplicate).toBe(true);
  });

  it('detects near-duplicate text without depending on the year token', () => {
    const similarity = calculateBlogInformationSimilarity(
      '2026 삿포로 식비 메뉴별 예산과 하루 경비',
      '2027 삿포로 식비 메뉴별 예산 및 하루 경비',
    );
    expect(similarity).toBeGreaterThan(0.7);
  });

  it('lets only the same owner resume a pending reservation', () => {
    const reserved = { ...active, status: 'reserved' as const, canonicalCreativeId: null, canonicalSlug: null };
    expect(decideBlogInformationDuplicate({
      candidate,
      existing: reserved,
      reservationOwner: 'queue-old',
    }).action).toBe('RESUME_RESERVATION');
    expect(decideBlogInformationDuplicate({
      candidate,
      existing: reserved,
      reservationOwner: 'queue-new',
    }).action).toBe('WAIT_FOR_EXISTING');
  });

  it('keeps legacy and product sitemap URLs while requiring new information rows to be canonical-active', () => {
    expect(isCanonicalInformationSitemapPost({ slug: 'legacy-post' })).toBe(true);
    expect(isCanonicalInformationSitemapPost({ slug: 'product-post', productId: 'product-1' })).toBe(true);
    expect(isCanonicalInformationSitemapPost({
      slug: 'canonical-post',
      generationMeta: { information_representative: { status: 'active', canonical_slug: 'canonical-post' } },
    })).toBe(true);
    expect(isCanonicalInformationSitemapPost({
      slug: 'duplicate-post',
      generationMeta: { information_representative: { status: 'active', canonical_slug: 'canonical-post' } },
    })).toBe(false);
  });

  it('keeps the representative repository isolated from product data', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/blog-information-representative-repository.ts'),
      'utf8',
    );
    expect(source).toContain("from('blog_information_representatives')");
    expect(source).not.toMatch(/travel_packages|product_snapshot|package-publication|product-registration/);
  });

  it('rejects unrecognized persisted identity values instead of reserving an arbitrary key', () => {
    expect(readBlogInformationRepresentativeIdentity({
      content_brief: {
        destination_id: 'sapporo',
        intent_type: 'unknown_intent',
        audience: 'general',
        locale: 'ko-KR',
      },
    })).toBeNull();
  });

  it('produces a read-only duplicate audit recommendation without redirects or merges', () => {
    const report = buildBlogInformationDuplicateDryRun([
      { ...candidate, slug: 'sapporo-food-budget-2026', publishedAt: '2026-01-01T00:00:00Z' },
      { ...candidate, slug: 'sapporo-food-budget-2027', publishedAt: '2027-01-01T00:00:00Z' },
    ]);
    expect(report).toEqual([expect.objectContaining({
      canonicalSlug: 'sapporo-food-budget-2026',
      duplicateSlugs: ['sapporo-food-budget-2027'],
      proposedAction: 'MERGE_REVIEW',
    })]);
  });
});
