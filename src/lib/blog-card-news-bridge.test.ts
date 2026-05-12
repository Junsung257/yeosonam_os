import { describe, it, expect } from 'vitest';
import { parsePublisherBridgeResponse } from './blog-card-news-bridge';

describe('parsePublisherBridgeResponse', () => {
  it('accepts valid bridge payload', () => {
    const parsed = parsePublisherBridgeResponse({
      publisher_bridge: true,
      blog_html: '# 제목\n\n본문 ![x](https://x/y.png)',
      slug: 'foo-cn',
      seo_title: '제목',
      seo_description: '설명',
      og_image_url: 'https://cdn/x.png',
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.slug).toBe('foo-cn');
    expect(parsed!.og_image_url).toBe('https://cdn/x.png');
  });

  it('rejects admin draft response (no publisher_bridge)', () => {
    expect(parsePublisherBridgeResponse({ blog: { id: '1' }, blog_html: 'x' })).toBeNull();
  });

  it('rejects empty body or slug', () => {
    expect(
      parsePublisherBridgeResponse({
        publisher_bridge: true,
        blog_html: '   ',
        slug: 'a',
        seo_title: '',
        seo_description: '',
      }),
    ).toBeNull();
    expect(
      parsePublisherBridgeResponse({
        publisher_bridge: true,
        blog_html: 'ok',
        slug: '',
        seo_title: '',
        seo_description: '',
      }),
    ).toBeNull();
  });
});
