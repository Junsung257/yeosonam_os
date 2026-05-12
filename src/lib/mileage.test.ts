/**
 * mileage 단위 테스트
 *
 * 재무 직결 — 마일리지 / 고객 등급 계산 (DB 트리거와 동일 로직).
 * 회귀 시 적립률 오작동 → 고객 누적 액수 왜곡.
 */

import { describe, it, expect } from 'vitest';
import {
  GRADE_CONFIG,
  calcMileageEarned,
  calcGrade,
  getNextAction,
} from './mileage';

describe('calcMileageEarned', () => {
  it('VVIP 5% 적립', () => {
    expect(calcMileageEarned(1_000_000, 'VVIP')).toBe(50_000);
  });

  it('우수 3% 적립', () => {
    expect(calcMileageEarned(1_000_000, '우수')).toBe(30_000);
  });

  it('일반/신규 1% 적립', () => {
    expect(calcMileageEarned(1_000_000, '일반')).toBe(10_000);
    expect(calcMileageEarned(1_000_000, '신규')).toBe(10_000);
  });

  it('알 수 없는 등급 → 신규(1%) fallback', () => {
    expect(calcMileageEarned(1_000_000, '천상천하유아독존')).toBe(10_000);
  });

  it('소수점은 round (Math.round)', () => {
    // 333,333 × 0.03 = 9,999.99 → 10,000
    expect(calcMileageEarned(333_333, '우수')).toBe(10_000);
  });

  it('금액 0 → 0', () => {
    expect(calcMileageEarned(0, 'VVIP')).toBe(0);
  });
});

describe('calcGrade — total_spent 임계값', () => {
  it('1000만원 이상 → VVIP', () => {
    expect(calcGrade(10_000_000)).toBe('VVIP');
    expect(calcGrade(50_000_000)).toBe('VVIP');
  });

  it('300만원~1000만원 미만 → 우수', () => {
    expect(calcGrade(3_000_000)).toBe('우수');
    expect(calcGrade(9_999_999)).toBe('우수');
  });

  it('50만원~300만원 미만 → 일반', () => {
    expect(calcGrade(500_000)).toBe('일반');
    expect(calcGrade(2_999_999)).toBe('일반');
  });

  it('50만원 미만 → 신규', () => {
    expect(calcGrade(0)).toBe('신규');
    expect(calcGrade(499_999)).toBe('신규');
  });
});

describe('calcGrade — cafe_score 보너스 경로', () => {
  it('cafe_score 50 이상이면 spent와 무관하게 VVIP', () => {
    expect(calcGrade(0, 50)).toBe('VVIP');
  });

  it('cafe_score 30~49 + 낮은 spent → 우수', () => {
    expect(calcGrade(0, 30)).toBe('우수');
  });

  it('cafe_score 10~29 + 낮은 spent → 일반', () => {
    expect(calcGrade(0, 10)).toBe('일반');
  });

  it('cafe_score 0~9 + 낮은 spent → 신규', () => {
    expect(calcGrade(0, 9)).toBe('신규');
  });

  it('spent 와 cafe 중 더 높은 등급 적용 (OR 분기)', () => {
    // spent=일반 임계, cafe=VVIP 임계 → VVIP
    expect(calcGrade(500_000, 50)).toBe('VVIP');
  });
});

describe('GRADE_CONFIG 일관성', () => {
  it('각 등급의 minSpent 가 calcGrade 분기와 일치', () => {
    expect(calcGrade(GRADE_CONFIG.VVIP.minSpent)).toBe('VVIP');
    expect(calcGrade(GRADE_CONFIG.우수.minSpent)).toBe('우수');
    expect(calcGrade(GRADE_CONFIG.일반.minSpent)).toBe('일반');
    expect(calcGrade(GRADE_CONFIG.신규.minSpent)).toBe('신규');
  });
});

describe('getNextAction — 라이프사이클 다음 액션', () => {
  it('잠재고객 → 첫 상담', () => {
    expect(getNextAction('잠재고객')?.type).toBe('call');
  });

  it('상담중 → 견적서', () => {
    expect(getNextAction('상담중')?.type).toBe('message');
  });

  it('예약완료 → 출발 전 안내', () => {
    expect(getNextAction('예약완료')?.type).toBe('notify');
  });

  it('여행중 → 안부 연락', () => {
    expect(getNextAction('여행중')?.type).toBe('check');
  });

  it('여행완료 + 3일 이상 → 후기 유도', () => {
    expect(getNextAction('여행완료', 5)?.type).toBe('review');
  });

  it('여행완료 + 3일 미만 → null (서두르지 않음)', () => {
    expect(getNextAction('여행완료', 1)).toBeNull();
  });

  it('알 수 없는 상태 → null', () => {
    expect(getNextAction('이상한상태')).toBeNull();
  });
});
