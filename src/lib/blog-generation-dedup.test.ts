import { describe, expect, it } from 'vitest';
import {
  buildBlogGenerationDedupKey,
  buildBlogGenerationTitleKey,
  BLOG_GENERATION_DEDUP_TITLE_NEAR_THRESHOLD,
  evaluateBlogGenerationDedup,
  normalizeBlogGenerationTitle,
} from './blog-generation-dedup';

describe('blog generation deduplication contract', () => {
  it('treats year and formatting-only title changes as the same future title', () => {
    const first = buildBlogGenerationTitleKey('2026년 삿포로 식비 가이드 | 여소남');
    const next = buildBlogGenerationTitleKey('2027 삿포로 식비 가이드 | 여소남');

    expect(first).toBe(next);
    expect(buildBlogGenerationDedupKey(first)).toMatch(/^v1\|title\|[0-9a-f]{64}$/);
  });

  it('hard-blocks exact slug and normalized title collisions', () => {
    const report = evaluateBlogGenerationDedup({
      title: '2027 삿포로 식비 가이드',
      slug: 'sapporo-food-budget-2027',
      destination: '삿포로',
      contentKind: 'information',
    }, [{
      id: 'creative-1',
      seoTitle: '2026 삿포로 식비 가이드',
      slug: 'sapporo-food-budget-2026',
      destination: '삿포로',
      contentKind: 'information',
    }]);

    expect(report.action).toBe('block');
    expect(report.reason).toBe('normalized_title_already_exists');
    expect(report.matches[0]?.existingId).toBe('creative-1');
  });

  it('allows a canonical replacement to compare against its own source row', () => {
    const report = evaluateBlogGenerationDedup({
      title: '삿포로 식비 가이드',
      slug: 'sapporo-food-budget-replacement-queue-1',
      destination: '삿포로',
      contentKind: 'information',
      allowExistingCreativeId: 'creative-1',
    }, [{
      id: 'creative-1',
      seoTitle: '2026 삿포로 식비 가이드',
      slug: 'sapporo-food-budget-2026',
      destination: '삿포로',
      contentKind: 'information',
    }]);

    expect(report.action).toBe('allow');
  });

  it('sends same-destination near titles to review instead of silently publishing', () => {
    const report = evaluateBlogGenerationDedup({
      title: '삿포로 식비 메뉴별 예산과 하루 경비',
      slug: 'sapporo-food-menu-budget',
      destination: '삿포로',
      contentKind: 'information',
    }, [{
      id: 'creative-2',
      seoTitle: '삿포로 식비 메뉴별 예산과 하루 비용',
      slug: 'sapporo-food-menu-cost',
      destination: '삿포로',
      contentKind: 'information',
    }]);

    expect(report.action).toBe('review');
    expect(report.reason).toBe('near_duplicate_title_requires_review');
    expect(report.similarity).toBeGreaterThanOrEqual(BLOG_GENERATION_DEDUP_TITLE_NEAR_THRESHOLD);
  });

  it('does not near-block similar wording for another destination', () => {
    const report = evaluateBlogGenerationDedup({
      title: '오사카 식비 메뉴별 예산과 하루 경비',
      slug: 'osaka-food-menu-budget',
      destination: '오사카',
      contentKind: 'information',
    }, [{
      id: 'creative-2',
      seoTitle: '삿포로 식비 메뉴별 예산과 하루 비용',
      slug: 'sapporo-food-menu-cost',
      destination: '삿포로',
      contentKind: 'information',
    }]);

    expect(report.action).toBe('allow');
    expect(normalizeBlogGenerationTitle('삿포로 2026년 식비 가이드')).toContain('삿포로');
  });

  it('sends near wording without a destination to review', () => {
    const report = evaluateBlogGenerationDedup({
      title: '여행 준비물 체크리스트와 팁',
      contentKind: 'information',
    }, [{
      id: 'creative-3',
      seoTitle: '여행 준비물 체크리스트와 실전 팁',
      destination: null,
      contentKind: 'information',
    }]);

    expect(report.action).toBe('review');
  });
});
