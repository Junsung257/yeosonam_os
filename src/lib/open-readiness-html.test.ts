import { describe, expect, it } from 'vitest';
import { blogDetailLooksRenderable } from '../../scripts/lib/open-readiness-html.mjs';

const validHead = [
  '<title>괌 7월 날씨 옷차림 여행 준비물 체크리스트 | 여소남</title>',
  '<meta name="robots" content="index, follow"/>',
  '<link rel="canonical" href="https://www.yeosonam.com/blog/guam-weather-packing"/>',
].join('');

describe('open readiness blog HTML detection', () => {
  it('accepts an indexable canonical article even when Next.js serializes a latent not-found branch', () => {
    const html = `${validHead}<body>정상 본문<script>페이지를 찾을 수 없습니다</script></body>`;
    expect(blogDetailLooksRenderable(html)).toBe(true);
  });

  it.each([
    '<title>페이지를 찾을 수 없습니다</title><meta name="robots" content="index, follow"/><link rel="canonical" href="https://www.yeosonam.com/blog/missing"/>',
    '<title>괌 여행</title><meta name="robots" content="noindex, follow"/><link rel="canonical" href="https://www.yeosonam.com/blog/guam"/>',
    '<title>괌 여행</title><meta name="robots" content="index, follow"/>',
  ])('rejects a real not-found, noindex, or non-canonical page', (html) => {
    expect(blogDetailLooksRenderable(html)).toBe(false);
  });
});
