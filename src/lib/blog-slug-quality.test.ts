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

  it('blocks generic product intro slugs', () => {
    const report = inspectBlogSlugQuality({
      slug: 'product-intro',
      primaryKeyword: '\uAD11\uC800\uC6B0 4\uBC156\uC77C \uD328\uD0A4\uC9C0',
      destination: '\uAD11\uC800\uC6B0',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('generic_product_intro_slug');
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

  it('blocks a generic slug when a known destination is missing', () => {
    const report = inspectBlogSlugQuality({
      slug: 'weather-checklist-july',
      primaryKeyword: '\uB450\uBC14\uC774 7\uC6D4 \uB0A0\uC528',
      destination: '\uB450\uBC14\uC774',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('missing_destination_slug');
  });
});
