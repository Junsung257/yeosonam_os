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

  it('reuses reviewed draft images without external image calls for private regeneration', async () => {
    const result = await ensureBlogInlineImages({
      markdown: '# 삿포로 식비\n\n## 하루 예산\n본문\n\n## 끼니별 예산\n본문\n\n## 지역별 차이\n본문',
      destination: '삿포로',
      primaryKeyword: '삿포로 식비',
      fallbackImageUrls: [
        'https://cdn.test/sapporo-1.jpg',
        'https://cdn.test/sapporo-2.jpg',
        'https://cdn.test/sapporo-3.jpg',
      ],
      preferFallbackImages: true,
      allowPexelsSearch: false,
      allowGeneratedFallback: false,
      minImages: 3,
    });

    expect(result.imageCount).toBe(3);
    expect(result.markdown).toContain('sapporo-1.jpg');
    expect(result.markdown).toContain('sapporo-2.jpg');
    expect(result.markdown).toContain('sapporo-3.jpg');
    expect(searchPexelsPhotos).not.toHaveBeenCalled();
    expect(generateSectionImage).not.toHaveBeenCalled();
  });

  it('fills exactly one private image shortfall with one relevant Pexels lookup', async () => {
    vi.mocked(searchPexelsPhotos).mockResolvedValueOnce([{
      id: 202,
      width: 1200,
      height: 627,
      alt: 'Sapporo Japan local food market and restaurant street',
      src: {
        landscape: 'https://images.pexels.com/photos/sapporo-section.jpg',
        large2x: '', large: '', original: '', medium: '', small: '', portrait: '', tiny: '',
      },
      url: '', photographer: '', photographer_url: '',
    }]);
    const result = await ensureBlogInlineImages({
      markdown: '# 삿포로 식비\n\n## 하루 예산\n본문\n\n## 끼니별 예산\n본문\n\n## 지역별 차이\n본문',
      destination: '삿포로',
      primaryKeyword: '삿포로 식비',
      fallbackImageUrls: [
        'https://cdn.test/sapporo-1.jpg',
        'https://cdn.test/sapporo-2.jpg',
      ],
      preferFallbackImages: true,
      allowPexelsSearch: true,
      allowGeneratedFallback: true,
      maxExternalAssetAttempts: 1,
      minImages: 3,
    });

    expect(result.imageCount).toBe(3);
    expect(result.markdown).toContain('sapporo-1.jpg');
    expect(result.markdown).toContain('sapporo-2.jpg');
    expect(result.markdown).toContain('sapporo-section.jpg');
    expect(searchPexelsPhotos).toHaveBeenCalledTimes(1);
    expect(generateSectionImage).not.toHaveBeenCalled();
  });

  it('checks a second Pexels page when the first page only returns used images', async () => {
    vi.mocked(searchPexelsPhotos)
      .mockResolvedValueOnce([{
        id: 301,
        width: 1200,
        height: 627,
        alt: 'Da Nang Vietnam winter city street',
        src: {
          landscape: 'https://images.pexels.com/photos/already-used.jpg',
          large2x: '', large: '', original: '', medium: '', small: '', portrait: '', tiny: '',
        },
        url: '', photographer: '', photographer_url: '',
      }])
      .mockResolvedValueOnce([{
        id: 302,
        width: 1200,
        height: 627,
        alt: 'Da Nang Vietnam city skyline and riverside landmark',
        src: {
          landscape: 'https://images.pexels.com/photos/sapporo-second-page.jpg',
          large2x: '', large: '', original: '', medium: '', small: '', portrait: '', tiny: '',
        },
        url: '', photographer: '', photographer_url: '',
      }]);

    const result = await ensureBlogInlineImages({
      markdown: [
        '# ?욱룷濡??ы뻾',
        '',
        '![?욱룷濡??쒖?](https://images.pexels.com/photos/already-used.jpg)',
        '',
        '## ?⑥궛 ?좎뵪',
        '蹂몃Ц',
      ].join('\n'),
      destination: '?욱룷濡?',
      primaryKeyword: '?욱룷濡??ы뻾',
      minImages: 2,
    });

    expect(result.markdown).toContain('sapporo-second-page.jpg');
    expect(searchPexelsPhotos).toHaveBeenNthCalledWith(2, expect.any(String), 18, 2);
  });
});
