import { describe, expect, it } from 'vitest';
import { extractBlogLearningFeatures } from './blog-learning-features';

describe('blog learning source features', () => {
  it('does not count stock images or arbitrary websites as official links', () => {
    const features = extractBlogLearningFeatures(
      '삿포로 월별 날씨',
      '삿포로 월별 날씨와 옷차림 안내',
      [
        '# 삿포로 월별 날씨',
        '',
        '삿포로 월별 날씨는 계절별 기온과 강수량을 함께 확인해야 합니다.',
        '',
        '![삿포로 풍경](https://images.pexels.com/photos/1/photo.jpg)',
        '[일반 여행 블로그](https://example.com/weather)',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
    );

    expect(features.imageCount).toBe(1);
    expect(features.externalLinkCount).toBe(2);
    expect(features.officialLinkCount).toBe(1);
  });
});
