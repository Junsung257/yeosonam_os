import sharp from 'sharp';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { stabilizeBlogMarkdownImages } from './blog-image-assets';

vi.mock('@/lib/pexels', () => ({
  destToEnKeyword: vi.fn((dest: string) => `${dest} travel landscape`),
  isPexelsConfigured: vi.fn(() => true),
  searchPexelsPhotos: vi.fn(async () => [
    {
      width: 1800,
      height: 1000,
      alt: 'Da Nang coastline',
      src: {
        landscape: 'https://images.pexels.com/photos/replacement.jpg',
        large2x: 'https://images.pexels.com/photos/replacement-large.jpg',
        large: 'https://images.pexels.com/photos/replacement-medium.jpg',
        original: 'https://images.pexels.com/photos/replacement-original.jpg',
      },
    },
  ]),
}));

async function makeImage(width = 1200, height = 675): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#3a7ca5',
    },
  }).jpeg().toBuffer();
}

describe('stabilizeBlogMarkdownImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors high-quality remote images to blog-assets URLs', async () => {
    const source = await makeImage();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(source), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })) as typeof fetch;
    const uploadAsset = vi.fn(async () => 'https://project.supabase.co/storage/v1/object/public/blog-assets/blog-inline/post/01.webp');

    const report = await stabilizeBlogMarkdownImages({
      markdown: '![Da Nang beach](https://images.pexels.com/photos/source.jpg)',
      slug: 'da-nang-guide',
      fetchImpl,
      uploadAsset,
      requireMirroredExternal: true,
    });

    expect(report.mirrored).toBe(1);
    expect(report.markdown).toContain('https://project.supabase.co/storage/v1/object/public/blog-assets/blog-inline/post/01.webp');
    expect(report.markdown).not.toContain('https://images.pexels.com/photos/source.jpg');
    expect(uploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'image/webp',
      sourceUrl: 'https://images.pexels.com/photos/source.jpg',
    }));
  });

  it('replaces broken source images with high-quality replacement photos before removing', async () => {
    const source = await makeImage();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('broken.jpg')) {
        return new Response('missing', { status: 404 });
      }
      return new Response(new Uint8Array(source), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as typeof fetch;
    const uploadAsset = vi.fn(async () => 'https://project.supabase.co/storage/v1/object/public/blog-assets/blog-inline/post/replacement.webp');

    const report = await stabilizeBlogMarkdownImages({
      markdown: '![Da Nang weather](https://images.pexels.com/photos/broken.jpg)',
      slug: 'da-nang-guide',
      destination: 'Da Nang',
      primaryKeyword: 'Da Nang travel',
      fetchImpl,
      uploadAsset,
      requireMirroredExternal: true,
    });

    expect(report.removed).toBe(0);
    expect(report.mirrored).toBe(1);
    expect(report.entries[0].reason).toContain('replacement_for:image_fetch_404');
    expect(report.markdown).toContain('replacement.webp');
  });
});
