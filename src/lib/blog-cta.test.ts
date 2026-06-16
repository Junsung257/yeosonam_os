import { describe, expect, it } from 'vitest';
import { buildStandardBlogCtaMarkdown } from './blog-cta';
import { computeSeoScore } from './blog-seo-scorer';

describe('buildStandardBlogCtaMarkdown', () => {
  it('emits valid markdown with at least two internal CTA links', () => {
    const markdown = buildStandardBlogCtaMarkdown({
      destination: '보라카이',
      slug: 'boracay-july-weather-clothing-packing',
      baseUrl: 'https://www.yeosonam.com',
      utmSource: 'naver_blog',
    });

    expect(markdown).toContain('[관련 패키지 보기](https://www.yeosonam.com/packages?');
    expect(markdown).toContain('[여소남 홈에서 상담 이어가기](https://www.yeosonam.com/?');
    expect(markdown).toContain('utm_content=packages_bottom');
    expect(markdown).toContain('utm_content=site_consult');

    const result = computeSeoScore({
      blogHtml: [
        '# 보라카이 7월 날씨와 옷차림 여행 준비물 체크리스트',
        '',
        '보라카이 7월 날씨는 우기와 높은 습도를 함께 확인해야 합니다. 옷차림, 방수 준비물, 이동 시간을 기준으로 정리합니다.',
        '',
        markdown,
      ].join('\n'),
      slug: 'boracay-july-weather-clothing-packing',
      seoTitle: '보라카이 7월 날씨와 옷차림 여행 준비물 체크리스트 2026',
      seoDescription: '보라카이 7월 날씨, 옷차림, 여행 준비물, 우기 대비 체크리스트를 예약 전 기준으로 정리했습니다.',
      primaryKeyword: '보라카이 7월 날씨',
      destination: '보라카이',
      blogType: 'info',
    });

    const internalLinks = result.details.find((detail) => detail.name === 'internal_links_cta');
    expect(internalLinks?.message).toMatch(/cta [23]/);
    expect(internalLinks?.status).not.toBe('fail');
  });
});
