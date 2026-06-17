import { describe, expect, it } from 'vitest';
import {
  evaluateBlogEditorialQuality,
  evaluateBlogTopicFit,
  filterTopicFitPassed,
} from './blog-topic-fit-gate';

describe('blog topic fit gate', () => {
  it('blocks real Korean seasonal lodging tangents before generation', () => {
    const report = evaluateBlogTopicFit({
      topic: '7월 필리핀 보라카이, 에어컨 없는 숙소 괜찮을까?',
      destination: '보라카이',
      primaryKeyword: '보라카이 7월',
      category: 'travel_tips',
      source: 'coverage_gap',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('seasonal_lodging_tangent');
  });

  it('blocks real Korean bad honeymoon destination combinations', () => {
    const report = evaluateBlogTopicFit({
      topic: '석가장 신혼여행 일정 추천',
      destination: '석가장',
      primaryKeyword: '석가장 신혼여행',
      category: 'travel_tips',
      source: 'gsc_longtail',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('destination_intent_mismatch');
  });

  it('blocks product topics that repeat the destination prefix', () => {
    const report = evaluateBlogTopicFit({
      topic: '연길/백두산 연길/백두산(북+남파) 3박4일 가성비 리뷰',
      destination: '연길/백두산',
      primaryKeyword: '연길/백두산 연길/백두산(북+남파) 3박4일',
      category: 'product_intro',
      source: 'product',
      productId: 'pkg-1',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('duplicate_destination_prefix');
  });

  it('blocks unsupported honeymoon destination combinations', () => {
    const report = evaluateBlogTopicFit({
      topic: '석가장 신혼여행 일정 추천',
      destination: '석가장',
      primaryKeyword: '석가장 신혼여행',
      category: 'travel_tips',
      source: 'gsc_longtail',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('destination_intent_mismatch');
  });

  it('blocks machine-generated slug topics before queue insert', () => {
    const { rows, rejected } = filterTopicFitPassed([
      {
        topic: 'post-yd8p',
        source: 'gsc_longtail',
        priority: 90,
        primary_keyword: 'post-yd8p',
        category: 'travel_tips',
      },
      {
        topic: '세부 3박 4일 여행 비용 체크리스트',
        destination: '세부',
        source: 'coverage_gap',
        priority: 60,
        primary_keyword: '세부 3박 4일 여행 비용',
        category: 'travel_tips',
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].meta?.topic_fit_gate).toMatchObject({ passed: true });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].report.issues.map((issue) => issue.code)).toContain('machine_slug_topic');
  });

  it('blocks seasonal destination-month lodging tangents', () => {
    const report = evaluateBlogTopicFit({
      topic: '7월 필리핀 보라카이, 에어컨 없는 숙소 괜찮을까?',
      destination: '보라카이',
      primaryKeyword: '보라카이 7월',
      category: 'travel_tips',
      source: 'seasonal',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('seasonal_intent_mismatch');
  });

  it('blocks placeholder text, excessive highlights, and broken Korean particles before publish', () => {
    const report = evaluateBlogEditorialQuality({
      slug: 'post-uo8h',
      topic: '관련 지역 여행 이미지',
      destination: null,
      primaryKeyword: '관련 지역',
      blogHtml: [
        '# 관련 지역 여행 가이드',
        '',
        '상품 보다 는 실제 일정이 중요합니다.',
        '',
        ...Array.from({ length: 9 }, (_, index) => `==핵심 요약 ${index + 1}==`),
        '',
        '![여행 이미지](https://images.pexels.com/photos/1.jpeg)',
        '<figcaption>여행 이미지</figcaption>',
        '![여행 이미지](https://images.pexels.com/photos/2.jpeg)',
        '<figcaption>핵심 요약</figcaption>',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'placeholder_text',
        'machine_slug_topic',
        'malformed_korean_particle',
        'excessive_highlights',
        'generic_image_context',
      ]),
    );
  });
});
