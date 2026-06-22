import { describe, expect, it } from 'vitest';
import {
  buildBlogPackageCtaUrl,
  buildStandardBlogCtaMarkdown,
  sanitizeBlogCtaLinks,
} from './blog-cta';
import { computeSeoScore } from './blog-seo-scorer';

describe('blog CTA helpers', () => {
  it('omits destination query when destination is missing', () => {
    const url = buildBlogPackageCtaUrl({
      destination: '',
      slug: 'travel-guide-q35bf6ed0',
      baseUrl: 'https://www.yeosonam.com',
      utmSource: 'naver_blog',
      content: 'intro_cta',
    });

    expect(url).toBe(
      'https://www.yeosonam.com/packages?utm_source=naver_blog&utm_medium=organic&utm_campaign=travel-guide-q35bf6ed0&utm_content=intro_cta',
    );
    expect(url).not.toContain('destination=');
  });

  it('keeps a valid destination query for package CTAs', () => {
    const url = buildBlogPackageCtaUrl({
      destination: '나트랑',
      slug: 'nhatrang-weather',
      baseUrl: 'https://www.yeosonam.com',
      utmSource: 'naver_blog',
      content: 'intro_cta',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('destination')).toBe('나트랑');
    expect(parsed.searchParams.get('utm_content')).toBe('intro_cta');
  });

  it('sanitizes empty or mismatched package destination links', () => {
    const markdown = [
      '[empty](https://www.yeosonam.com/packages?destination=&utm_source=naver_blog)',
      '[wrong](/packages?destination=%EB%82%98%ED%8A%B8%EB%9E%99&utm_source=naver_blog)',
    ].join('\n');

    const sanitized = sanitizeBlogCtaLinks(markdown, {
      destination: '나트랑',
      slug: 'nhatrang-weather',
      baseUrl: 'https://www.yeosonam.com',
      utmSource: 'naver_blog',
    });

    expect(sanitized).not.toContain('destination=&');
    expect(sanitized).not.toContain('%EB%82%98%ED%8A%B8%EB%9E%99');
    expect(sanitized).toContain('destination=%EB%82%98%ED%8A%B8%EB%9E%91');
  });

  it('emits valid markdown with at least two internal CTA links', () => {
    const markdown = buildStandardBlogCtaMarkdown({
      destination: '보라카이',
      slug: 'boracay-july-weather-clothing-packing',
      baseUrl: 'https://www.yeosonam.com',
      utmSource: 'naver_blog',
    });

    expect(markdown).toContain('[관련 패키지 보기](https://www.yeosonam.com/packages?');
    expect(markdown).toContain('[여소남에서 상담 이어가기](https://www.yeosonam.com/?');
    expect(markdown).toContain('utm_content=packages_bottom');
    expect(markdown).toContain('utm_content=site_consult');

    const result = computeSeoScore({
      blogHtml: [
        '# 보라카이 7월 날씨와 옷차림 여행 준비물',
        '',
        '보라카이 7월 날씨는 우기와 습도를 함께 확인해야 합니다. 옷차림, 방수 준비물, 이동 시간을 기준으로 정리합니다.',
        '',
        markdown,
      ].join('\n'),
      slug: 'boracay-july-weather-clothing-packing',
      seoTitle: '보라카이 7월 날씨와 옷차림 여행 준비물 2026',
      seoDescription: '보라카이 7월 날씨, 옷차림, 여행 준비물, 우기 체크리스트를 예약 전 기준으로 정리했습니다.',
      primaryKeyword: '보라카이 7월 날씨',
      destination: '보라카이',
      blogType: 'info',
    });

    const internalLinks = result.details.find((detail) => detail.name === 'internal_links_cta');
    expect(internalLinks?.message).toMatch(/cta [23]/);
    expect(internalLinks?.status).not.toBe('fail');
  });
});
