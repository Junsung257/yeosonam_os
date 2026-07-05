import { describe, expect, it } from 'vitest';

import {
  isProxyableBlogImageUrl,
  proxyBlogImageUrlsInHtml,
  toBlogImageDisplaySrc,
} from './blog-image-proxy';

describe('blog-image-proxy', () => {
  it('proxies Pexels images through the site route', () => {
    const src = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&w=1200';

    expect(isProxyableBlogImageUrl(src)).toBe(true);
    expect(toBlogImageDisplaySrc(src)).toBe(
      `/api/blog/image?src=${encodeURIComponent(src)}&w=960`,
    );
  });

  it('proxies Wikimedia Commons file images through the site route', () => {
    const src = 'https://commons.wikimedia.org/wiki/Special:FilePath/Yun%20Dong-ju.jpg?width=480';

    expect(isProxyableBlogImageUrl(src)).toBe(true);
    expect(toBlogImageDisplaySrc(src)).toBe(
      `/api/blog/image?src=${encodeURIComponent(src)}&w=960`,
    );
  });

  it('leaves unsupported hosts unchanged', () => {
    const src = 'https://example.com/image.jpg';

    expect(isProxyableBlogImageUrl(src)).toBe(false);
    expect(toBlogImageDisplaySrc(src)).toBe(src);
  });

  it('rewrites rendered blog image html without changing alt text', () => {
    const src = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&w=1200';
    const html = `<p><img src="${src}" alt="Bohol weather"></p>`;

    const rewritten = proxyBlogImageUrlsInHtml(html);

    expect(rewritten).toContain(`/api/blog/image?src=${encodeURIComponent(src)}&w=960`);
    expect(rewritten).toContain('alt="Bohol weather"');
    expect(rewritten).not.toContain('src="https://images.pexels.com');
  });

  it('rewrites Wikimedia image html through the same proxy', () => {
    const src = 'https://commons.wikimedia.org/wiki/Special:FilePath/Yun%20Dong-ju.jpg?width=480';
    const html = `<p><img src="${src}" alt="Yanji travel"></p>`;

    const rewritten = proxyBlogImageUrlsInHtml(html);

    expect(rewritten).toContain(`/api/blog/image?src=${encodeURIComponent(src)}&w=960`);
    expect(rewritten).toContain('alt="Yanji travel"');
    expect(rewritten).not.toContain('src="https://commons.wikimedia.org');
  });
});
