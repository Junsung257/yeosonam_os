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
      `/api/blog/image?src=${encodeURIComponent(src)}`,
    );
  });

  it('leaves unsupported hosts unchanged', () => {
    const src = 'https://example.com/image.jpg';

    expect(isProxyableBlogImageUrl(src)).toBe(false);
    expect(toBlogImageDisplaySrc(src)).toBe(src);
  });

  it('rewrites rendered blog image html without changing alt text', () => {
    const src = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&w=1200';
    const html = `<p><img src="${src}" alt="장가계 월별 날씨"></p>`;

    const rewritten = proxyBlogImageUrlsInHtml(html);

    expect(rewritten).toContain(`/api/blog/image?src=${encodeURIComponent(src)}`);
    expect(rewritten).toContain('alt="장가계 월별 날씨"');
    expect(rewritten).not.toContain('src="https://images.pexels.com');
  });
});
