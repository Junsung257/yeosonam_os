import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureBlogInlineImages } from './blog-inline-images';
import { isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';

vi.mock('@/lib/pexels', () => ({
  destToEnKeyword: vi.fn(() => 'Da Nang Vietnam travel'),
  isPexelsConfigured: vi.fn(() => true),
  searchPexelsPhotos: vi.fn(async () => [
    {
      id: 101,
      width: 1200,
      height: 627,
      alt: 'Da Nang Vietnam city street and local landmark',
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

  it('prefers contextual Pexels images and uses OG only when no second relevant photo exists', async () => {
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
    expect(result.markdown).toContain('![다낭 날씨와 옷차림](https://images.pexels.com/photos/section.jpg)');
    expect(result.markdown).toContain('![다낭 추천 일정](https://cdn.test/og.jpg)');
    expect(searchPexelsPhotos).toHaveBeenCalledWith(
      expect.stringContaining('Da Nang Vietnam travel'),
      18,
      1,
    );
  });

  it('rejects an unrelated coastal result for an inland city and selects the city photo', async () => {
    vi.mocked(searchPexelsPhotos).mockResolvedValueOnce([
      {
        id: 1,
        width: 1200,
        height: 627,
        alt: 'Waves breaking on a tropical ocean beach',
        src: {
          landscape: 'https://images.pexels.com/photos/wrong-coast.jpg',
          large2x: '', large: '', original: '', medium: '', small: '', portrait: '', tiny: '',
        },
        url: '', photographer: '', photographer_url: '',
      },
      {
        id: 2,
        width: 1200,
        height: 627,
        alt: 'Guangzhou Canton Tower city skyline under cloudy weather',
        src: {
          landscape: 'https://images.pexels.com/photos/guangzhou-city.jpg',
          large2x: '', large: '', original: '', medium: '', small: '', portrait: '', tiny: '',
        },
        url: '', photographer: '', photographer_url: '',
      },
    ]);

    const result = await ensureBlogInlineImages({
      markdown: '# 광저우 날씨\n\n## 월별 날씨와 옷차림\n본문입니다.',
      destination: '광저우',
      primaryKeyword: '광저우 월별 날씨',
      minImages: 1,
    });

    expect(result.markdown).toContain('guangzhou-city.jpg');
    expect(result.markdown).not.toContain('wrong-coast.jpg');
  });

  it('does not block publishing when no image provider is configured', async () => {
    vi.mocked(isPexelsConfigured).mockReturnValue(false);
    const markdown = '# 여행 정보\n\n## 준비물\n본문입니다.';

    const result = await ensureBlogInlineImages({ markdown, minImages: 1 });

    expect(result.inserted).toBe(0);
    expect(result.markdown).toBe(markdown);
  });
});
