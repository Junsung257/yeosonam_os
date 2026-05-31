import { describe, expect, it } from 'vitest';
import { buildRecommendationDisplay, hotelGradeLabel } from './recommendation-display';

describe('buildRecommendationDisplay', () => {
  it('shows a comparison recommendation even when reviews are not part of the input', () => {
    const display = buildRecommendationDisplay({
      package_id: 'pkg-1',
      group_size: 3,
      rank_in_group: 1,
      shopping_count: 0,
      hotel_avg_grade: 4.7,
      free_option_count: 2,
      is_direct_flight: true,
      list_price: 1000000,
      effective_price: 820000,
      breakdown: {
        why: ['호텔 위치가 좋아요', '실효가 820000 KRW', '무료 옵션 2개 보너스'],
      },
    });

    expect(display).not.toBeNull();
    expect(display?.hasComparison).toBe(true);
    expect(display?.label).toBe('편하게 가기 좋은 구성 ✨');
    expect(display?.comparisonSummary).toContain('같은 날짜 상품 3개');
    expect(display?.hotelGradeLabel).toBe('호텔 우수');
    expect(display?.reasons).toEqual([
      '같은 날짜 상품 3개를 비교했어요',
      '쇼핑 일정 부담이 적어요',
      '호텔 조건이 좋은 편이에요',
      '직항 조건을 확인했어요',
    ]);
    expect(display?.reasons.join(' ')).not.toMatch(/실효|KRW|보너스|환산|차감/);
  });

  it('falls back to a condition check when there is no comparison group yet', () => {
    const display = buildRecommendationDisplay({
      package_id: 'pkg-2',
      group_size: 1,
      rank_in_group: 1,
      shopping_count: 2,
      hotel_avg_grade: 3.6,
      breakdown: { why: ['일정이 여유로워요'] },
    });

    expect(display?.hasComparison).toBe(false);
    expect(display?.label).toBe('조건 확인 완료');
    expect(display?.comparisonSummary).toBe('가격·호텔·쇼핑·옵션 조건을 확인했어요');
    expect(display?.reasons).toContain('쇼핑 2회 포함 여부를 확인했어요');
  });
});

describe('hotelGradeLabel', () => {
  it('maps hotel grades to customer-safe labels', () => {
    expect(hotelGradeLabel(4.8)).toBe('호텔 우수');
    expect(hotelGradeLabel(4.0)).toBe('호텔 무난');
    expect(hotelGradeLabel(3.2)).toBe('호텔 확인 필요');
    expect(hotelGradeLabel(null)).toBe('호텔 확인 필요');
  });
});
