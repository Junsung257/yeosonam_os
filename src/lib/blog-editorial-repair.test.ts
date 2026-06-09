import { describe, expect, it } from 'vitest';
import { repairBlogEditorialQuality } from './blog-editorial-repair';

describe('blog editorial repair', () => {
  it('repairs informational sales tone and missing weather table', () => {
    const source = `# 장가계 월별 날씨와 옷차림 가이드

장가계 날씨는 월별로 체감 차이가 커서 옷차림과 우기 준비를 함께 보셔야 합니다.

## 장가계 날씨 핵심

이 상품을 고른 이유는 여행 정보를 확인하는 데 도움이 되기 때문입니다. 우기에는 비가 올 수 있고 건기에는 걷기 좋은 날도 있습니다.
`;

    const result = repairBlogEditorialQuality({
      title: '장가계 월별 날씨와 옷차림 가이드',
      category: 'weather',
      contentType: 'guide',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('sanitized_info_sales_tone');
    expect(result.changes).toContain('added_weather_check_table');
    expect(result.blogHtml).toContain('월별 날씨 체크표');
    expect(result.blogHtml).not.toContain('이 상품');
    expect(result.after.score).toBeGreaterThan(result.before.score);
  });

  it('adds official sources for high-change information posts', () => {
    const result = repairBlogEditorialQuality({
      title: '베트남 무비자 입국 규정 총정리',
      category: 'visa',
      contentType: 'guide',
      blogHtml: `# 베트남 무비자 입국 규정 총정리

## 체류 기간

베트남 입국 규정은 출발 전 확인해야 합니다.

## 준비 서류

- 여권
- 항공권
- 숙소 정보
`,
    });

    expect(result.changes).toContain('added_official_reference_links');
    expect(result.blogHtml).toContain('외교부 해외안전여행');
  });
});
