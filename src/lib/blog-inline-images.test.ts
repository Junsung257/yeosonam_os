import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureBlogInlineImages } from './blog-inline-images';
import { isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';

vi.mock('@/lib/pexels', () => ({
  destToEnKeyword: vi.fn(() => 'Da Nang Vietnam travel'),
  isPexelsConfigured: vi.fn(() => true),
  searchPexelsPhotos: vi.fn(async () => [
    {
      src: {
        landscape: 'https://images.pexels.com/photos/section.jpg',
        large2x: 'https://images.pexels.com/photos/section-large2x.jpg',
        large: 'https://images.pexels.com/photos/section-large.jpg',
        original: 'https://images.pexels.com/photos/section-original.jpg',
      },
    },
  ]),
}));

describe('ensureBlogInlineImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPexelsConfigured).mockReturnValue(true);
  });

  it('leaves articles with enough images untouched', async () => {
    const markdown = [
      '# 다낭 여행',
      '',
      '![다낭 표지](https://cdn.test/cover.jpg)',
      '',
      '## 일정',
      '![다낭 일정](https://cdn.test/section.jpg)',
    ].join('\n');

    const result = await ensureBlogInlineImages({ markdown, minImages: 2 });

    expect(result.inserted).toBe(0);
    expect(result.markdown).toBe(markdown);
    expect(searchPexelsPhotos).not.toHaveBeenCalled();
  });

  it('inserts OG and Pexels images below H2 sections when body images are missing', async () => {
    const markdown = [
      '# 다낭 여행',
      '',
      '도입부입니다.',
      '',
      '## 날씨와 옷차림',
      '본문입니다.',
      '',
      '## 추천 일정',
      '본문입니다.',
    ].join('\n');

    const result = await ensureBlogInlineImages({
      markdown,
      destination: '다낭',
      primaryKeyword: '다낭 여행',
      ogImageUrl: 'https://cdn.test/og.jpg',
      minImages: 2,
    });

    expect(result.inserted).toBe(2);
    expect(result.markdown).toContain('![다낭 날씨와 옷차림](https://cdn.test/og.jpg)');
    expect(result.markdown).toContain('![다낭 추천 일정](https://images.pexels.com/photos/section.jpg)');
  });

  it('does not block publishing when no image provider is configured', async () => {
    vi.mocked(isPexelsConfigured).mockReturnValue(false);
    const markdown = '# 여행 정보\n\n## 준비물\n본문입니다.';

    const result = await ensureBlogInlineImages({ markdown, minImages: 1 });

    expect(result.inserted).toBe(0);
    expect(result.markdown).toBe(markdown);
  });
});
