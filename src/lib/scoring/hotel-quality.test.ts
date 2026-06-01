import { describe, expect, it } from 'vitest';
import { scoreHotelQuality } from './hotel-quality';

describe('scoreHotelQuality', () => {
  it('requires more than a star grade alone before calling a hotel excellent', () => {
    const result = scoreHotelQuality({ hotelAvgGrade: 4.8 });

    expect(result.label).toBe('호텔 무난');
    expect(result.confidence).toBe('low');
    expect(result.reasons).toContain('호텔 등급 조건이 좋아요');
  });

  it('upgrades strong hotel evidence when external quality data agrees', () => {
    const result = scoreHotelQuality({
      hotelAvgGrade: 4.7,
      mrtCompositeScore: 84,
      mrtMatchScore: 0.82,
      pricePercentile: 0.28,
    });

    expect(result.label).toBe('호텔 우수');
    expect(result.confidence).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(76);
    expect(result.reasons).toContain('외부 호텔 데이터도 양호해요');
  });

  it('keeps weak or uncertain hotel evidence customer-safe', () => {
    const result = scoreHotelQuality({
      hotelAvgGrade: 3.2,
      mrtCompositeScore: 52,
      mrtMatchScore: 0.4,
    });

    expect(result.label).toBe('호텔 확인 필요');
    expect(result.reasons).toContain('호텔명 매칭 신뢰도가 낮아요');
  });
});
