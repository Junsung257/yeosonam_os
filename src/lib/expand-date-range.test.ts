/**
 * expand-date-range 단위 테스트
 *
 * DetailClient.tsx (filterTiersByDepartureDays) + A4 포스터가 사용.
 * 회귀 시 모바일 랜딩 가격표에 잘못된 요일 출발일 노출 → 예약 사고.
 *
 * 커버:
 *   - parseDayIndices (간접): "일,월" / "매주 목요일" / "매일" 모두 처리
 *   - expandDateRangeToArray: 기간 + 요일 → 개별 날짜 배열
 *   - expandPriceTiersDateRanges: tiers 일괄 + departure_day_of_week 역산
 *   - filterTiersByDepartureDays: 상품 출발요일과 불일치 tier 제거
 *   - 제외일 파싱: "(5/21,22 제외)" 같은 인라인 메모
 */

import { describe, it, expect } from 'vitest';
import type { PriceTier } from './parser';
import {
  expandDateRangeToArray,
  expandPriceTiersDateRanges,
  filterTiersByDepartureDays,
} from './expand-date-range';

describe('expandDateRangeToArray', () => {
  it('범위 + 단일 요일 (수) → 해당 요일만', () => {
    // 2026-04-01 (수)
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      departureDayOfWeek: '수',
    });
    expect(dates.length).toBeGreaterThanOrEqual(4);
    for (const d of dates) {
      const [y, m, day] = d.split('-').map(Number);
      expect(new Date(y, m - 1, day).getDay()).toBe(3); // 수
    }
  });

  it('복수 요일 "일,월" → 둘 다 포함', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-14' },
      departureDayOfWeek: '일,월',
    });
    const dows = new Set(dates.map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day).getDay();
    }));
    expect(dows.has(0)).toBe(true); // 일
    expect(dows.has(1)).toBe(true); // 월
    expect(dows.has(2)).toBe(false); // 화 없음
  });

  it('"매주 목요일" → 목요일만', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      departureDayOfWeek: '매주 목요일',
    });
    for (const d of dates) {
      const [y, m, day] = d.split('-').map(Number);
      expect(new Date(y, m - 1, day).getDay()).toBe(4); // 목
    }
  });

  it('"매일" → 모든 날짜', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-07' },
      departureDayOfWeek: '매일',
    });
    expect(dates).toHaveLength(7);
  });

  it('기간 역전 (start > end) → []', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-30', end: '2026-04-01' },
      departureDayOfWeek: '수',
    });
    expect(dates).toEqual([]);
  });

  it('요일 없으면 → []', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
    });
    expect(dates).toEqual([]);
  });

  it('상품 출발요일 fallback', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-04-01', end: '2026-04-30' },
      departureDayOfWeek: undefined,
      departureDays: '금',
    });
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      const [y, m, day] = d.split('-').map(Number);
      expect(new Date(y, m - 1, day).getDay()).toBe(5); // 금
    }
  });

  it('period_label 의 "(5/21,22 제외)" 파싱', () => {
    const dates = expandDateRangeToArray({
      dateRange: { start: '2026-05-01', end: '2026-05-31' },
      departureDayOfWeek: '매일',
      periodLabel: '5월 (5/21,22 제외)',
    });
    expect(dates).not.toContain('2026-05-21');
    expect(dates).not.toContain('2026-05-22');
    expect(dates).toContain('2026-05-20');
    expect(dates).toContain('2026-05-23');
  });
});

describe('expandPriceTiersDateRanges', () => {
  it('이미 departure_dates 가 있으면 보존 + 정확한 요일 역산', () => {
    const tiers: PriceTier[] = [
      {
        period_label: '4월',
        adult_price: 1_000_000,
        departure_dates: ['2026-04-05', '2026-04-06'], // 일, 월
        departure_day_of_week: '잘못된 요일',
        status: 'open',
      } as never,
    ];
    const r = expandPriceTiersDateRanges(tiers);
    expect(r[0].departure_dates).toEqual(['2026-04-05', '2026-04-06']);
    expect(r[0].departure_day_of_week).toBe('일,월'); // 역산으로 정정
  });

  it('date_range 만 있으면 전개 + 요일 부여', () => {
    const tiers: PriceTier[] = [
      {
        period_label: '4월',
        adult_price: 1_000_000,
        date_range: { start: '2026-04-01', end: '2026-04-30' },
        departure_day_of_week: '수',
        status: 'open',
      } as never,
    ];
    const r = expandPriceTiersDateRanges(tiers);
    expect(r[0].departure_dates?.length).toBeGreaterThan(0);
    expect(r[0].departure_day_of_week).toBe('수');
  });

  it('date_range + 요일 정보 모두 없으면 변경 없음', () => {
    const tiers: PriceTier[] = [
      { period_label: '4월', adult_price: 1_000_000, status: 'open' } as never,
    ];
    const r = expandPriceTiersDateRanges(tiers);
    expect(r[0].departure_dates).toBeUndefined();
  });
});

describe('filterTiersByDepartureDays — 상품 출발요일 매칭', () => {
  const tiers: PriceTier[] = [
    { period_label: 'A', adult_price: 1, departure_day_of_week: '일,월', status: 'open' } as never,
    { period_label: 'B', adult_price: 2, departure_day_of_week: '목', status: 'open' } as never,
    { period_label: 'C', adult_price: 3, departure_day_of_week: '금,토', status: 'open' } as never,
    { period_label: 'D', adult_price: 4, status: 'open' } as never, // 요일 없음
  ];

  it('상품 출발요일 미지정 → 전체 통과', () => {
    expect(filterTiersByDepartureDays(tiers)).toHaveLength(4);
  });

  it('상품 "일,월" → A 포함, B/C 제외, D 통과(미지정 안전 유지)', () => {
    const r = filterTiersByDepartureDays(tiers, '일,월');
    const labels = r.map(t => t.period_label);
    expect(labels).toContain('A');
    expect(labels).not.toContain('B');
    expect(labels).not.toContain('C');
    expect(labels).toContain('D');
  });

  it('상품 "목" → B만 매칭 (+ D 미지정)', () => {
    const r = filterTiersByDepartureDays(tiers, '목');
    const labels = r.map(t => t.period_label);
    expect(labels).toEqual(expect.arrayContaining(['B', 'D']));
    expect(labels).not.toContain('A');
    expect(labels).not.toContain('C');
  });

  it('교집합 매칭: 상품 "월,화" + tier "일,월" → 월 겹치므로 통과', () => {
    const r = filterTiersByDepartureDays(tiers, '월,화');
    const labels = r.map(t => t.period_label);
    expect(labels).toContain('A'); // 일,월 ∩ 월,화 = 월
  });

  it('상품 요일이 파싱 불가 → 전체 통과 (안전)', () => {
    const r = filterTiersByDepartureDays(tiers, '???');
    expect(r).toHaveLength(4);
  });
});
