import { describe, expect, it } from 'vitest';
import { computeSeoScore } from './blog-seo-scorer';
import { repairBlogSeoMetadata } from './blog-seo-repair';

describe('blog SEO repair', () => {
  it('repairs weak title and description metadata before publish blocking', () => {
    const blogHtml = [
      '# 7월 출발 해외여행',
      '',
      '2026년 7월 출발 항공권은 비용, 일정, 예약 시점에 따라 차이가 큽니다.',
      '',
      '## 비용 비교',
      '',
      '| 항목 | 기준 | 확인 포인트 |',
      '| --- | --- | --- |',
      '| 항공권 | 7일 전 | 요일과 시간대 비교 |',
      '| 숙소 | 3박 | 위치와 이동 시간 확인 |',
      '',
      '## 준비물',
      '',
      '- 여권',
      '- 결제 카드',
      '- 비상 연락처',
      '',
      '## 자주 묻는 질문',
      '',
      'Q. 언제 예약해야 하나요?',
      'A. 출발 2주 전부터 가격 변동을 확인하는 편이 안전합니다.',
      '',
      '## 공식 확인',
      '',
      '- [외교부 해외안전여행](https://www.0404.go.kr/dev/main.mofa)',
      '- [인천국제공항](https://www.airport.kr/ap/ko/index.do)',
      '',
      '[여행 상담](/packages)',
      '[추천 상품](/packages?utm_source=naver_blog)',
      '[관련 글](/blog)',
    ].join('\n');

    const before = computeSeoScore({
      blogHtml,
      slug: 'cheap-flight-tips',
      seoTitle: '항공권 저렴하게 예약하는 마지막 팁',
      seoDescription: '항공권 예약 팁입니다.',
      primaryKeyword: '7월 출발 해외여행',
      blogType: 'info',
      imageCount: 3,
      imagesWithAlt: 3,
      hasJsonLd: { blogPosting: true, faqPage: true, breadcrumbList: true },
    });

    const repair = repairBlogSeoMetadata({
      seoTitle: '항공권 저렴하게 예약하는 마지막 팁',
      seoDescription: '항공권 예약 팁입니다.',
      topic: '7월 출발 해외여행, 항공권 저렴하게 예약하는 마지막 팁',
      primaryKeyword: '7월 출발 해외여행',
      category: 'travel_tips',
    });

    const after = computeSeoScore({
      blogHtml,
      slug: 'cheap-flight-tips',
      seoTitle: repair.seoTitle,
      seoDescription: repair.seoDescription,
      primaryKeyword: '7월 출발 해외여행',
      blogType: 'info',
      imageCount: 3,
      imagesWithAlt: 3,
      hasJsonLd: { blogPosting: true, faqPage: true, breadcrumbList: true },
    });

    expect(repair.changed).toBe(true);
    expect(repair.changes).toEqual(expect.arrayContaining(['seo_title', 'seo_description']));
    expect(after.details.find(detail => detail.name === 'title')?.status).toBe('pass');
    expect(after.score).toBeGreaterThan(before.score);
  });
});
