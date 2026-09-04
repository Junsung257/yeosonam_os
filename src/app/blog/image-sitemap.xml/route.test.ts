import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadPublicBlogCatalog } = vi.hoisted(() => ({
  loadPublicBlogCatalog: vi.fn(),
}));

vi.mock('@/lib/blog-public-catalog', () => ({ loadPublicBlogCatalog }));
vi.mock('@/lib/blog-canonical-url', () => ({
  resolveBlogCanonicalOrigin: () => 'https://www.yeosonam.com',
}));

import { GET, dynamic } from './route';

describe('blog image sitemap', () => {
  beforeEach(() => {
    loadPublicBlogCatalog.mockReset();
  });

  it('emits only absolute catalog images and does not invent image titles', async () => {
    loadPublicBlogCatalog.mockResolvedValue([
      { slug: 'safe & useful', seo_title: 'Article title is not a pixel description', og_image_url: 'https://images.pexels.com/photos/123/a.jpg' },
      { slug: 'relative', seo_title: 'Relative', og_image_url: '/og-image.png' },
      { slug: 'missing', seo_title: 'Missing', og_image_url: null },
    ]);

    const response = await GET();
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(body).toContain('<loc>https://www.yeosonam.com/blog/safe%20%26%20useful</loc>');
    expect(body).toContain('<image:loc>https://images.pexels.com/photos/123/a.jpg</image:loc>');
    expect(body).not.toContain('<image:title>');
    expect(body).not.toContain('/blog/relative');
    expect(body).not.toContain('/blog/missing');
  });

  it('uses a serverless handler for Vercel output conversion', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
