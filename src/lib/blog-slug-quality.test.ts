import { describe, expect, it } from 'vitest';
import { inspectBlogSlugQuality } from './blog-slug-quality';

describe('blog slug quality', () => {
  it('blocks generated hash suffix slugs', () => {
    const report = inspectBlogSlugQuality({
      slug: 'travel-guide-q35bf6ed0',
      primaryKeyword: '오사카 7월 날씨',
      destination: '오사카',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['hash_suffix_slug', 'generic_travel_guide_slug']),
    );
  });

  it('blocks numeric-leading slugs', () => {
    const report = inspectBlogSlugQuality({
      slug: '6-danang',
      primaryKeyword: '다낭 날씨',
      destination: '다낭',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('numeric_leading_slug');
  });

  it('passes reader-facing longtail slugs', () => {
    const report = inspectBlogSlugQuality({
      slug: 'bali-transport-cost',
      primaryKeyword: '발리 교통비',
      destination: '발리',
    });

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
