import { describe, expect, it } from 'vitest';
import { generateImageSeoMeta, optimizeImageSeoInHtml } from './blog-image-seo';

describe('blog image metadata safety', () => {
  it('does not invent pixel descriptions from article keywords', () => {
    expect(generateImageSeoMeta(0, 1, {
      destination: '다낭',
      primaryKeyword: '다낭 8월 날씨',
      sectionTitle: '옷차림',
    })).toEqual({ alt: '' });
  });

  it('leaves authored markdown unchanged instead of appending generic alt or captions', () => {
    const markdown = '# 다낭\n\n![](https://cdn.test/photo.jpg)';
    expect(optimizeImageSeoInHtml(markdown, '다낭', '다낭 날씨')).toBe(markdown);
  });
});
