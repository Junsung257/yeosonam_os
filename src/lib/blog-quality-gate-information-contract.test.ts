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

  it('blocks a generic Sapporo food-budget fallback without meal prices or a daily budget', () => {
    const result = checkIntentQuality({
      blog_html: [
        '# 삿포로 식비 가이드',
        '',
        '삿포로에서는 여행 동선과 취향에 따라 식당을 고르면 좋습니다.',
        '',
        '## 식사 준비',
        '아침, 점심, 저녁 식당을 미리 살펴보세요.',
        '',
        '## 확인 사항',
        '영업시간과 결제 수단은 방문 전에 확인하세요.',
      ].join('\n'),
      slug: 'sapporo-food-budget',
      blog_type: 'info',
      destination: '삿포로',
      primary_keyword: '삿포로 식비',
      category: 'food',
      content_type: 'guide',
      micro_angle: 'food_budget',
      generation_meta: { content_brief: { intent_type: 'food_budget' } },
    });

    expect(result.passed).toBe(false);
    expect(result.evidence?.informationContract).toMatchObject({
      intentType: 'food_budget',
      passed: false,
    });
  });

  it('blocks a generic Guangzhou weather fallback without a 12-month climate table', () => {
    const result = checkIntentQuality({
      blog_html: [
        '# 광저우 월별 날씨',
        '',
        '광저우 여행은 계절에 맞는 옷차림과 우산을 준비하면 좋습니다.',
        '',
        '## 날씨 준비',
        '- 더운 날에는 얇은 옷을 챙기세요.',
        '- 비가 오면 우산을 준비하세요.',
        '',
        '## 출발 전 확인',
        '최신 예보를 확인하세요.',
      ].join('\n'),
      slug: 'guangzhou-weather',
      blog_type: 'info',
      destination: '광저우',
      primary_keyword: '광저우 월별 날씨',
      category: 'weather',
      content_type: 'guide',
      micro_angle: 'weather_packing',
      generation_meta: { content_brief: { intent_type: 'monthly_weather' } },
    });

    expect(result.passed).toBe(false);
    expect(result.evidence?.informationContract).toMatchObject({
      intentType: 'monthly_weather',
      passed: false,
    });
  });
});
