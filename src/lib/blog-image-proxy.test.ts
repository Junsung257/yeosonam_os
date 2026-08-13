import { describe, expect, it } from 'vitest';
import {
  BLOG_IMAGE_PROXY_WIDTHS,
  buildBlogImageSrcSet,
  normalizeBlogImageProxyWidth,
  proxyBlogImageUrlsInHtml,
  toBlogImageProxySrc,
} from './blog-image-proxy';

describe('blog image proxy variants', () => {
  const source = 'https://images.pexels.com/photos/123/example.jpg';

  it('emits the five production width variants', () => {
    const srcSet = buildBlogImageSrcSet(source);
    for (const width of BLOG_IMAGE_PROXY_WIDTHS) {
      expect(srcSet).toContain(`w=${width}`);
      expect(srcSet).toContain(`${width}w`);
    }
    expect(srcSet?.split(', ')).toHaveLength(5);
  });

  it('normalizes arbitrary widths and refuses a srcset for an untrusted host', () => {
    expect(normalizeBlogImageProxyWidth(700)).toBe(768);
    expect(normalizeBlogImageProxyWidth(1920)).toBe(1600);
    expect(toBlogImageProxySrc(source, '', { width: 700 })).toContain('w=768');
    expect(buildBlogImageSrcSet('https://example.com/not-allowed.jpg')).toBeUndefined();
  });

  it('optimizes only the Yeosonam public blog asset bucket', () => {
    const blogAsset = 'https://ixaxnvbmhzjvupissmly.supabase.co/storage/v1/object/public/blog-assets/generated/blog/example.jpg';
    expect(buildBlogImageSrcSet(blogAsset)?.split(', ')).toHaveLength(5);
    expect(buildBlogImageSrcSet('https://other-project.supabase.co/storage/v1/object/public/blog-assets/example.jpg')).toBeUndefined();
    expect(buildBlogImageSrcSet('https://ixaxnvbmhzjvupissmly.supabase.co/storage/v1/object/public/private-assets/example.jpg')).toBeUndefined();
  });

  it('adds responsive, lazy, intrinsic attributes to trusted inline images without inventing alt text', () => {
    const html = '<p><img src="https://images.pexels.com/photos/123/example.jpg?w=1200&h=627" alt="실제 장면"></p>';
    const rendered = proxyBlogImageUrlsInHtml(html);
    expect(rendered).toContain('src="/api/blog/image?');
    expect(rendered).toContain('srcset="/api/blog/image?');
    expect(rendered).toContain('480w');
    expect(rendered).toContain('1600w');
    expect(rendered).toContain('sizes="(max-width: 768px) 100vw, 760px"');
    expect(rendered).toContain('width="1200"');
    expect(rendered).toContain('height="627"');
    expect(rendered).toContain('loading="lazy"');
    expect(rendered).toContain('decoding="async"');
    expect(rendered).toContain('alt="실제 장면"');
  });

  it('leaves untrusted inline image URLs untouched', () => {
    const html = '<img src="https://example.com/image.jpg" alt="">';
    expect(proxyBlogImageUrlsInHtml(html)).toBe(html);
  });
});
