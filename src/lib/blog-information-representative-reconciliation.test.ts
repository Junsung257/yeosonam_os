import { describe, expect, it } from 'vitest';
import type { BlogInformationDuplicateCandidate, BlogInformationRepresentativeRecord } from './blog-information-representative';
import {
  reserveBlogInformationRepresentativeWithStore,
  type BlogInformationRepresentativeReservationStore,
} from './blog-information-representative-repository';
import {
  BLOG_INFORMATION_RECONCILIATION_CONFIRMATION,
  BLOG_INFORMATION_RECONCILIATION_ENV_VALUE,
  assertBlogInformationReconciliationApplyAuthorized,
  reconcileBlogInformationRepresentativesDryRun,
  type BlogInformationLegacyArticle,
} from './blog-information-representative-reconciliation';

function article(overrides: Partial<BlogInformationLegacyArticle> = {}): BlogInformationLegacyArticle {
  const id = overrides.id ?? 'article-1';
  return {
    id,
    slug: overrides.slug ?? 'sapporo-food-budget',
    title: overrides.title ?? '삿포로 식비 가이드',
    markdown: overrides.markdown ?? '삿포로 식비와 메뉴 가격을 정리합니다.',
    destination: overrides.destination ?? '삿포로',
    status: overrides.status ?? 'published',
    productId: overrides.productId ?? null,
    reviewStatus: overrides.reviewStatus ?? 'none',
    publishedAt: overrides.publishedAt ?? '2025-01-01T00:00:00.000Z',
    generationMeta: overrides.generationMeta ?? {
      content_brief: {
        destination_id: 'sapporo',
        intent_type: 'food_budget',
        audience: 'general',
        locale: 'ko-KR',
      },
    },
  };
}

function representative(overrides: Partial<BlogInformationRepresentativeRecord> = {}): BlogInformationRepresentativeRecord {
  return {
    representativeKey: 'v1|sapporo|food_budget|general|ko-KR',
    destinationId: 'sapporo',
    intent: 'food_budget',
    audience: 'general',
    locale: 'ko-KR',
    canonicalCreativeId: 'article-1',
    canonicalSlug: 'sapporo-food-budget',
    status: 'active',
    reservationOwner: 'legacy-owner',
    ...overrides,
  };
}

describe('legacy informational representative reconciliation', () => {
  it('offers exactly one safe legacy URL as a dry-run backfill candidate', () => {
    const report = reconcileBlogInformationRepresentativesDryRun({ articles: [article()], representatives: [] });
    expect(report).toMatchObject({ dryRun: true, databaseWrites: 0 });
    expect(report.items[0]).toMatchObject({
      decision: 'BACKFILL_CANDIDATE',
      canonicalCreativeId: 'article-1',
      canonicalSlug: 'sapporo-food-budget',
      mayApply: true,
    });
  });

  it('routes multiple same-identity public articles to human canonical review', () => {
    const report = reconcileBlogInformationRepresentativesDryRun({
      articles: [
        article(),
        article({ id: 'article-2', slug: 'sapporo-food-budget-2026', publishedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      representatives: [],
    });
    expect(report.items[0]).toMatchObject({ decision: 'MULTIPLE_CANDIDATES', mayApply: false });
    expect(report.items[0].canonicalSlug).toBe('sapporo-food-budget');
  });

  it('never auto-backfills high-risk entry or insurance content', () => {
    const highRisk = article({
      title: '한국인 일본 입국 비자 조건',
      slug: 'japan-entry',
      destination: '일본',
      generationMeta: {
        content_brief: {
          destination_id: 'japan', intent_type: 'entry_requirements', audience: 'general', locale: 'ko-KR',
        },
      },
    });
    const report = reconcileBlogInformationRepresentativesDryRun({ articles: [highRisk], representatives: [] });
    expect(report.items[0]).toMatchObject({ decision: 'HIGH_RISK', mayApply: false });
  });

  it('keeps an active representative URL and treats a new year as update-existing policy', () => {
    const report = reconcileBlogInformationRepresentativesDryRun({
      articles: [article({ title: '2027 삿포로 식비 가이드' })],
      representatives: [representative()],
    });
    expect(report.items[0]).toMatchObject({
      decision: 'REGISTRY_PRESENT',
      canonicalSlug: 'sapporo-food-budget',
      mayApply: false,
    });
  });

  it('flags canonical mismatch, duplicate slugs, and unknown review states', () => {
    const mismatch = reconcileBlogInformationRepresentativesDryRun({
      articles: [article()],
      representatives: [representative({ canonicalCreativeId: 'other', canonicalSlug: 'other-slug' })],
    });
    expect(mismatch.items[0].decision).toBe('CANONICAL_MISMATCH');

    const collision = reconcileBlogInformationRepresentativesDryRun({
      articles: [
        article(),
        article({
          id: 'article-2',
          generationMeta: {
            content_brief: {
              destination_id: 'tokyo', intent_type: 'hotel_areas', audience: 'general', locale: 'ko-KR',
            },
          },
        }),
      ],
      representatives: [],
    });
    expect(collision.items.map((item) => item.decision)).toEqual(['SLUG_COLLISION', 'SLUG_COLLISION']);

    const unknown = reconcileBlogInformationRepresentativesDryRun({
      articles: [article({ reviewStatus: 'pending_review' })],
      representatives: [],
    });
    expect(unknown.items[0].decision).toBe('REVIEW_UNKNOWN');
  });

  it('refuses apply without both the environment switch and explicit confirmation', () => {
    expect(() => assertBlogInformationReconciliationApplyAuthorized({ apply: true }))
      .toThrow('blog_information_reconciliation_apply_not_authorized');
    expect(() => assertBlogInformationReconciliationApplyAuthorized({
      apply: true,
      confirmation: BLOG_INFORMATION_RECONCILIATION_CONFIRMATION,
      environmentValue: BLOG_INFORMATION_RECONCILIATION_ENV_VALUE,
    })).not.toThrow();
    expect(() => assertBlogInformationReconciliationApplyAuthorized({ apply: false })).not.toThrow();
  });
});

describe('representative reservation concurrency', () => {
  it('allows only one create under concurrent reservation attempts', async () => {
    const rows = new Map<string, BlogInformationRepresentativeRecord>();
    const store: BlogInformationRepresentativeReservationStore = {
      async find(key) { return rows.get(key) ?? null; },
      async insert(input) {
        if (rows.has(input.representativeKey)) return 'conflict';
        rows.set(input.representativeKey, {
          representativeKey: input.representativeKey,
          destinationId: input.candidate.destinationId,
          intent: input.candidate.intent,
          audience: input.candidate.audience,
          locale: input.candidate.locale,
          canonicalCreativeId: null,
          canonicalSlug: null,
          status: 'reserved',
          reservationOwner: input.reservationOwner,
        });
        return 'inserted';
      },
    };
    const candidate: BlogInformationDuplicateCandidate = {
      destinationId: 'sapporo', intent: 'food_budget', audience: 'general', locale: 'ko-KR',
      slug: 'candidate', title: '삿포로 식비', markdown: '본문',
    };
    const decisions = await Promise.all([
      reserveBlogInformationRepresentativeWithStore({ candidate, reservationOwner: 'owner-a' }, store),
      reserveBlogInformationRepresentativeWithStore({ candidate, reservationOwner: 'owner-b' }, store),
    ]);
    expect(decisions.map((decision) => decision.action).sort())
      .toEqual(['RESERVE_CREATE', 'WAIT_FOR_EXISTING']);
    expect(rows).toHaveLength(1);
  });
});
