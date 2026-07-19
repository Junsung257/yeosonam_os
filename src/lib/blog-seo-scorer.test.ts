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

  it('recognizes the verified runtime CTA for informational articles without body sales links', () => {
    const result = computeSeoScore({
      blogHtml: '# 삿포로 식비\n\n## 하루 예산\n\n관련 내용을 충분히 설명합니다.',
      slug: 'sapporo-food-budget-guide',
      blogType: 'info',
      primaryKeyword: '삿포로 식비',
      destination: '삿포로',
      hasRuntimeInformationalCta: true,
    });

    expect(result.details.find((detail) => detail.name === 'internal_links_cta')).toMatchObject({
      score: 7,
      status: 'pass',
    });
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

  it('blocks public posts that contain localhost CTA links', () => {
    const result = computeSeoScore({
      blogHtml: strongMarkdown.replace(
        '/packages?destination=%EB%B0%A9%EC%BD%95&utm_source=organic&utm_medium=blog',
        'http://localhost:3000/packages/pkg-1?utm=blog_bottom',
      ),
      slug: 'bangkok-weather-monthly-clothes-checklist',
      seoTitle: '諛⑹퐬 ?좎뵪 ?붾퀎 ?룹감由쇨낵 ?ы뻾 以鍮꾨Ъ 泥댄겕由ъ뒪??2026',
      seoDescription: '諛⑹퐬 ?좎뵪瑜??붾퀎 湲곗삩, ?곌린쨌嫄닿린, ?룹감由? ?ы뻾 鍮꾩슜, ?낃뎅 ?쒕쪟 湲곗??쇰줈 ?뺣━??2026??以鍮?泥댄겕由ъ뒪?몄엯?덈떎.',
      primaryKeyword: '諛⑹퐬 ?좎뵪',
      secondaryKeywords: ['諛⑹퐬 ?룹감由?', '諛⑹퐬 ?ы뻾 鍮꾩슜', '諛⑹퐬 ?낃뎅 ?쒕쪟'],
      destination: '諛⑹퐬',
      blogType: 'info',
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: true,
      },
    });

    const linkIntegrity = result.details.find((detail) => detail.name === 'public_link_integrity');
    expect(linkIntegrity?.status).toBe('fail');
    expect(linkIntegrity?.message).toContain('localhost');
    expect(result.passed).toBe(false);
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

  it('blocks mixed-intent titles that attach weather modifiers to a cost article', () => {
    const result = computeSeoScore({
      blogHtml: strongMarkdown.replaceAll('방콕 날씨', '발리 교통비'),
      slug: 'bali-transport-cost',
      seoTitle: '발리 교통비 여행 가이드 2026 | 날씨와 옷차림 체크',
      seoDescription: '발리 교통비를 공항 픽업, 택시, 이동 시간, 예약 전 확인 비용 기준으로 정리했습니다.',
      primaryKeyword: '발리 교통비',
      secondaryKeywords: ['발리 공항 픽업', '발리 택시 비용'],
      destination: '발리',
      blogType: 'info',
      imageCount: 3,
      imagesWithAlt: 3,
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: true,
      },
    });

    const title = result.details.find((detail) => detail.name === 'title');
    expect(title?.status).toBe('fail');
    expect(title?.message).toContain('mixed intent');
    expect(result.passed).toBe(false);
  });

  it('blocks generated hash suffix slugs even when the article body is otherwise strong', () => {
    const result = computeSeoScore({
      blogHtml: strongMarkdown,
      slug: 'travel-guide-q35bf6ed0',
      seoTitle: '오사카 7월 날씨 여행 가이드 2026 | 월별 날씨와 옷차림 체크',
      seoDescription: '오사카 7월 날씨를 2026년 기준으로 정리했습니다. 월별 기온, 옷차림, 준비물, 비 오는 날 동선까지 확인하세요.',
      primaryKeyword: '오사카 7월 날씨',
      secondaryKeywords: ['오사카 옷차림', '오사카 준비물'],
      destination: '오사카',
      blogType: 'info',
      imageCount: 3,
      imagesWithAlt: 3,
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: true,
      },
    });

    const slug = result.details.find((detail) => detail.name === 'url_slug');
    expect(slug?.status).toBe('fail');
    expect(slug?.message).toContain('hash_suffix_slug');
    expect(result.passed).toBe(false);
  });

  it('treats product-consult commercial decision signals as valid SEO metadata', () => {
    const body = [
      '# 서안 4박6일 가성비 패키지',
      '',
      '서안 4박6일 패키지는 부산/김해 출발, 44만원대 시작가, 포함 조건, 일정 강도, 현지 추가 비용을 문의 전에 비교해야 합니다.',
      '',
      '## 10초 판단',
      '## 포함 조건',
      '## 불포함 조건',
      '## 일정 체감',
      '## 맞는 사람',
      '## 안 맞는 사람',
      '## 가격 변동 조건',
      '## 문의 전 질문',
      '',
      '![서안 여행 예산 체크 장면](https://images.pexels.com/photos/123/pexels-photo-123.jpeg)',
      '![서안 일정 준비 장면](https://images.pexels.com/photos/124/pexels-photo-124.jpeg)',
      '![서안 현지 비용 확인 장면](https://images.pexels.com/photos/125/pexels-photo-125.jpeg)',
      '',
      '[상품 조건 확인](https://www.yeosonam.com/packages/pkg-1?utm=blog_bottom)',
      '[상담 문의](https://www.yeosonam.com/group-inquiry?utm_source=blog)',
      '[서안 글 더 보기](/blog)',
    ].join('\n\n');

    const result = computeSeoScore({
      blogHtml: body,
      slug: 'xian-bx-xian-4-6',
      seoTitle: '부산/김해출발 서안 4박6일 가성비 패키지 44만원~ (2026)',
      seoDescription: '서안 일정과 이동 동선을 2026년 기준으로 정리했습니다. 예약 전 확인할 비용, 일정, 준비물, 현지 체크 포인트를 한 번에 확인하세요.',
      primaryKeyword: '서안 4박6일',
      destination: '서안',
      blogType: 'product',
    });

    expect(result.details.find((detail) => detail.name === 'title')?.status).toBe('pass');
    expect(result.details.find((detail) => detail.name === 'meta_description')?.status).toBe('pass');
    expect(result.details.find((detail) => detail.name === 'heading_structure')?.status).toBe('pass');
    expect(result.details.find((detail) => detail.name === 'image_seo')?.status).toBe('pass');
  });

  it('accepts one soft bottom CTA for informational guides', () => {
    const result = computeSeoScore({
      blogHtml: [
        '# 유럽 자유여행 팁',
        '',
        '유럽 자유여행 팁은 예산과 실제 비용을 먼저 보고, 일정과 준비물을 출발 전 다시 확인하면 실수가 줄어듭니다.',
        '',
        '## 예산 체크',
        '## 일정 체크',
        '## 준비물 체크',
        '## 이동 동선',
        '## 공식 확인',
        '',
        '[내 일정 기준 상품 확인](/packages?destination=%EC%9C%A0%EB%9F%BD)',
        '[다른 여행 글 보기](/blog)',
      ].join('\n\n'),
      slug: 'europe-independent-travel-tips-july-2026',
      seoTitle: '유럽 자유여행 팁 여행 가이드 2026 | 예산 · 경비 · 비용 절약 체크',
      seoDescription: '유럽 자유여행 팁 예산과 실제 비용을 2026년 기준으로 정리했습니다. 예약 전 확인할 비용, 일정, 준비물, 현지 체크 포인트를 한 번에 확인하세요.',
      primaryKeyword: '유럽 자유여행 팁',
      destination: '유럽',
      blogType: 'info',
    });

    expect(result.details.find((detail) => detail.name === 'internal_links_cta')?.status).toBe('pass');
  });

  it('accepts concise readable two-word English slugs after slug quality passes', () => {
    const result = computeSeoScore({
      blogHtml: [
        '# 클락 맛집과 식비',
        '',
        '클락 예산과 실제 비용을 2026년 기준으로 정리했습니다. 식비, 일정, 준비물, 예약 전 체크 포인트를 확인하세요.',
        '',
        '## 식비 예산',
        '## 맛집 동선',
        '## 현지 결제',
        '## 준비물',
        '## 상담 전 체크',
      ].join('\n\n'),
      slug: 'clark-food',
      seoTitle: '클락 여행 가이드 2026 | 예산과 실제 비용 체크',
      seoDescription: '클락 예산과 실제 비용을 2026년 기준으로 정리했습니다. 예약 전 확인할 비용, 일정, 준비물, 현지 체크 포인트를 한 번에 확인하세요.',
      primaryKeyword: '클락',
      destination: '클락',
      blogType: 'info',
    });

    expect(result.details.find((detail) => detail.name === 'url_slug')?.status).toBe('pass');
  });
});
