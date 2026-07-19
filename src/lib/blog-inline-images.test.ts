import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureBlogInlineImages } from './blog-inline-images';
import { isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';
import { generateSectionImage } from '@/lib/blog-image-gen';

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

vi.mock('@/lib/blog-image-gen', () => ({
  generateSectionImage: vi.fn(async () => null),
  isGeneratedBlogImageUrl: vi.fn((value: string | null | undefined) =>
    typeof value === 'string' && value.includes('/generated/blog/')),
}));

describe('ensureBlogInlineImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPexelsConfigured).mockReturnValue(true);
    vi.mocked(generateSectionImage).mockResolvedValue(null);
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

  it('uses a clearly disclosed AI reference image when Pexels has no relevant result', async () => {
    vi.mocked(searchPexelsPhotos).mockResolvedValue([]);
    vi.mocked(generateSectionImage).mockResolvedValue(
      'https://cdn.test/storage/v1/object/public/blog-assets/generated/blog/aa/image.jpg',
    );

    const result = await ensureBlogInlineImages({
      markdown: '# 삿포로 식비\n\n## 끼니별 예산\n본문입니다.',
      destination: '삿포로',
      primaryKeyword: '삿포로 식비',
      minImages: 1,
    });

    expect(generateSectionImage).toHaveBeenCalledWith(
      '끼니별 예산',
      '삿포로 식비',
      '삿포로',
      { skipPexelsFallback: true },
    );
    expect(result.markdown).toContain('![AI 생성 참고 이미지: 삿포로 끼니별 예산]');
    expect(result.markdown).toContain('AI 생성 참고 이미지 · 실제 현장 기록이나 최신 운영 상황의 증거로 사용하지 않습니다.');
  });
});
