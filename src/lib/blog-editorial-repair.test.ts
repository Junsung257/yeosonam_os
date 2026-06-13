import { describe, expect, it } from 'vitest';
import {
  repairBlogEditorialQuality,
  repairBlogStructureQuality,
  repairKeywordDensityToTarget,
} from './blog-editorial-repair';

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
  it('repairs raw directive leaks and collapsed checklist items', () => {
    const source = [
      '# 여행 준비 체크',
      '',
      '::: tip',
      '출발 전에 확인하세요.',
      ':::',
      '',
      '## 준비 체크리스트',
      '',
      '- 1. 여권 유효기간을 확인합니다. 2. 항공권 영문 이름을 확인합니다. 3. 현지 결제 카드와 소액 현금을 나눠 챙깁니다. 4. 비상 연락처를 가족에게 공유합니다.',
    ].join('\n');

    const result = repairBlogStructureQuality({
      title: '여행 준비 체크',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: source,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual(
      expect.arrayContaining(['removed_raw_directive_leaks', 'split_collapsed_checklist_items']),
    );
    expect(result.blogHtml).not.toContain(':::');
    expect(result.blogHtml).toContain('- 여권 유효기간을 확인합니다.');
    expect(result.blogHtml).toContain('- 항공권 영문 이름을 확인합니다.');
  });

  it('reduces excessive primary keyword density deterministically', () => {
    const source = Array.from(
      { length: 18 },
      () => '해외여행 비상약은 해외여행 비상약 준비에서 자주 반복되는 주제입니다.',
    ).join('\n\n');

    const result = repairKeywordDensityToTarget(source, '해외여행 비상약', 'info');

    expect(result.changed).toBe(true);
    expect(result.beforeCount).toBeGreaterThan(result.allowedCount);
    expect(result.afterCount).toBeLessThanOrEqual(result.allowedCount);
    expect(result.blogHtml).toContain('비상약');
  });
});
