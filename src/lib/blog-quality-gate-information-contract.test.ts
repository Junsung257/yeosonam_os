import { describe, expect, it } from 'vitest';
import { checkIntentQuality } from './blog-quality-gate';

describe('blog quality gate information contract', () => {
  it('blocks an informational article when intent-specific required slots are absent', () => {
    const result = checkIntentQuality({
      blog_html: '# 다낭 공항 교통\n\n공항에서 시내로 이동하는 방법을 간단히 소개합니다.',
      slug: 'da-nang-airport-transport',
      blog_type: 'info',
      destination: '다낭',
      primary_keyword: '다낭 공항 교통',
      category: 'transport',
      content_type: 'guide',
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('information contract failed');
    expect(result.evidence?.informationContract).toMatchObject({
      intentType: 'airport_transport',
      passed: false,
    });
  });

  it('does not apply the informational contract to product-backed content', () => {
    const result = checkIntentQuality({
      blog_html: '# 다낭 패키지\n\n상품 일정과 포함 사항을 확인하세요.',
      slug: 'da-nang-package',
      blog_type: 'product',
      destination: '다낭',
      primary_keyword: '다낭 패키지',
      category: 'product_intro',
      content_type: 'package_intro',
      product_id: 'product-1',
    });

    expect(result.evidence).not.toHaveProperty('informationContract');
  });

  it('uses the persisted planner intent instead of reclassifying a repaired title', () => {
    const result = checkIntentQuality({
      blog_html: '# 오사카 여행 안내\n\n수정된 제목이지만 공항 교통 필수 항목은 아직 없습니다.',
      slug: 'osaka-guide',
      blog_type: 'info',
      destination: '오사카',
      primary_keyword: '오사카 여행 안내',
      category: 'weather',
      content_type: 'guide',
      generation_meta: {
        content_brief: { intent_type: 'airport_transport' },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.evidence?.informationContract).toMatchObject({
      intentType: 'airport_transport',
      passed: false,
    });
  });
});
