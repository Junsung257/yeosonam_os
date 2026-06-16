import { describe, expect, it } from 'vitest';
import { BLOG_SEO_MAX_SCORE, BLOG_SEO_MIN_SCORE, computeSeoScore } from './blog-seo-scorer';

const longBody = Array.from({ length: 18 }, (_, index) => (
  `방콕 날씨는 ${2026 + (index % 2)}년 기준으로 월별 기온, 우기, 건기, 옷차림을 함께 봐야 합니다. ` +
  `여소남 운영팀은 공항 이동 시간 ${40 + index}분, 예상 비용 ${12000 + index * 1000}원, 호텔 위치와 예약 포함사항을 확인했습니다. ` +
  `여행 일정과 준비물 체크리스트를 비교하면 현지에서 놓치는 비용과 시간을 줄일 수 있습니다.`
)).join('\n\n');

const strongMarkdown = `# 방콕 날씨 월별 옷차림과 여행 준비물 체크리스트

${longBody}

## 방콕 날씨는 월별로 어떻게 달라지나요?

1. 1월부터 2월은 건기라 이동 시간이 짧습니다.
2. 6월부터 10월은 우기라 우산과 방수 가방을 준비하세요.

## 방콕 여행 비용과 일정은 어떻게 잡을까요?

| 항목 | 기준 |
| --- | --- |
| 공항 이동 | 40~60분 |
| 식사 비용 | 1인 12,000원부터 |

## 방콕 입국 서류와 환전 체크

[관련 패키지 보기](/packages?destination=%EB%B0%A9%EC%BD%95&utm_source=organic&utm_medium=blog)
[여소남 상담 문의](/?utm_source=organic&utm_medium=blog&utm_content=mid_cta)
[방콕 여행 가이드](/blog/bangkok-guide)
[태국 관광청 공식 정보](https://www.tourismthailand.org/)
[외교부 해외안전여행](https://www.0404.go.kr/)

## 자주 묻는 질문

Q. 방콕 날씨 기준으로 언제 출발하면 좋나요?
A. 건기를 선호하면 11월부터 2월이 좋고, 항공권 가격까지 같이 비교해야 합니다.

![방콕 날씨 월별 옷차림](https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg)
![방콕 여행 준비물 체크리스트](https://images.pexels.com/photos/23456/pexels-photo-23456.jpeg)
![방콕 공항 이동과 일정](https://images.pexels.com/photos/34567/pexels-photo-34567.jpeg)
`;

describe('computeSeoScore', () => {
  it('passes a search-ready longtail travel article', () => {
    const result = computeSeoScore({
      blogHtml: strongMarkdown,
      slug: 'bangkok-weather-monthly-clothes-checklist',
      seoTitle: '방콕 날씨 월별 옷차림과 여행 준비물 체크리스트 2026',
      seoDescription: '방콕 날씨를 월별 기온, 우기·건기, 옷차림, 여행 비용, 입국 서류 기준으로 정리한 2026년 준비 체크리스트입니다.',
      primaryKeyword: '방콕 날씨',
      secondaryKeywords: ['방콕 옷차림', '방콕 여행 비용', '방콕 입국 서류'],
      destination: '방콕',
      blogType: 'info',
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: true,
      },
    });

    expect(result.maxScore).toBe(BLOG_SEO_MAX_SCORE);
    expect(result.score).toBeGreaterThanOrEqual(BLOG_SEO_MIN_SCORE.info);
    expect(result.passed).toBe(true);
  });

  it('blocks thin content without metadata or structure', () => {
    const result = computeSeoScore({
      blogHtml: '# 방콕\n\n방콕 여행 좋아요.',
      slug: 'draft-v2',
      blogType: 'info',
      primaryKeyword: '방콕 날씨',
      destination: '방콕',
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(BLOG_SEO_MIN_SCORE.info);
    expect(result.details.filter((detail) => detail.status === 'fail').length).toBeGreaterThan(0);
  });

  it('does not count markdown image and link targets as long raw urls', () => {
    const longUrl = 'https://images.pexels.com/photos/123456789/pexels-photo-123456789.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200&utm_source=very-long-tracking-value';
    const result = computeSeoScore({
      blogHtml: [
        '# Guam preparation checklist',
        '',
        'Practical 2026 preparation details with costs, timing, weather, and booking checks.',
        '',
        '## Summary',
        '',
        `![Guam beach](${longUrl})`,
        '',
        `[Official guide](${longUrl})`,
      ].join('\n'),
      slug: 'guam-preparation-checklist',
      seoTitle: 'Guam preparation checklist 2026',
      seoDescription: 'Guam preparation checklist for 2026 with costs, weather, booking timing, and final travel checks.',
      primaryKeyword: 'Guam preparation',
      destination: 'Guam',
      blogType: 'info',
    });

    const mobile = result.details.find((detail) => detail.name === 'mobile_snippet_safety');
    expect(mobile?.message).toContain('long raw urls 0');
  });

  it('matches hyphenated slug keywords against readable spaced article text', () => {
    const result = computeSeoScore({
      blogHtml: [
        '# 6월 유럽 여행 성수기 전 항공권 가이드',
        '',
        '6월 유럽 여행 성수기 전 항공권은 출발일, 경유 시간, 수하물 조건을 같이 봐야 합니다.',
        '6월 유럽 여행 성수기 전 항공권을 비교할 때는 총액 기준으로 확인하세요.',
      ].join('\n'),
      slug: 'june-europe-flight-ticket',
      seoTitle: '6월 유럽 여행 성수기 전 항공권 가이드 2026',
      seoDescription: '6월 유럽 여행 성수기 전 항공권 비교 기준과 예약 전 확인할 비용, 일정, 수하물 조건을 정리했습니다.',
      primaryKeyword: '6월-유럽-여행-성수기-전-항공권',
      blogType: 'info',
    });

    const primary = result.details.find((detail) => detail.name === 'primary_keyword');
    expect(primary?.score).toBeGreaterThan(0);
    expect(primary?.message).not.toContain('0회');
  });
});
