/**
 * price-dates 단위 테스트
 *
 * 가격 표시 단일 진실 소스 — 모바일 랜딩 + A4 포스터 + 검색 필터가 공유.
 * 회귀 위험:
 *   - new Date('YYYY-MM-DD') UTC 파싱으로 KST 하루 밀림 (safeDayOfWeek/safeMonth/safeDay 가 차단)
 *   - ERR-20260418-29: groupForPoster 청크 분할 시 globalMin 외부 주입 (청크 내 최저가 오표시 방지)
 *   - ERR-20260418-06: Strict Grouping — 요일 강제 병합 금지, "1 요일 + 1 가격 = 1 행"
 *   - ERR-HET-price-table-desc-order: 월 내 정렬은 날짜 오름차순 (가격 우선 정렬 금지)
 *   - ERR-LB-DAD-displayprice: getMinPriceFromDates 가 0/음수 가격 필터링
 */

import { describe, it, expect } from 'vitest';
import {
  type PriceDate,
  tiersToDatePrices,
  getEffectivePriceDates,
  getStrictPriceDates,
  groupForPoster,
  getMinPriceFromDates,
  getNextDepartureFromDates,
} from './price-dates';

describe('getMinPriceFromDates', () => {
  it('빈 배열 → 0', () => {
    expect(getMinPriceFromDates([])).toBe(0);
  });

  it('정상 가격 중 최저가', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-01', price: 1_500_000, confirmed: true },
      { date: '2026-04-08', price: 1_200_000, confirmed: false },
      { date: '2026-04-15', price: 1_800_000, confirmed: false },
    ];
    expect(getMinPriceFromDates(dates)).toBe(1_200_000);
  });

  it('0/음수 가격은 필터링 (ERR-LB-DAD-displayprice)', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-01', price: 0, confirmed: false },
      { date: '2026-04-08', price: 1_500_000, confirmed: false },
    ];
    expect(getMinPriceFromDates(dates)).toBe(1_500_000);
  });

  it('모든 가격이 0 → 0 반환', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-01', price: 0, confirmed: false },
    ];
    expect(getMinPriceFromDates(dates)).toBe(0);
  });
});

describe('getEffectivePriceDates — 폴백 로직', () => {
  it('price_dates 있으면 그대로 반환', () => {
    const dates: PriceDate[] = [{ date: '2026-04-01', price: 1_000_000, confirmed: true }];
    const r = getEffectivePriceDates({ price_dates: dates });
    expect(r).toBe(dates);
  });

  it('price_dates 없으면 price_tiers 변환', () => {
    const r = getEffectivePriceDates({
      price_tiers: [
        { period_label: '4월', adult_price: 1_500_000, departure_dates: ['2026-04-01'] } as never,
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe('2026-04-01');
    expect(r[0].price).toBe(1_500_000);
  });

  it('둘 다 비어있으면 []', () => {
    expect(getEffectivePriceDates({})).toEqual([]);
  });

  it('price_dates 빈 배열이면 tiers 폴백', () => {
    const r = getEffectivePriceDates({
      price_dates: [],
      price_tiers: [
        { period_label: '5월', adult_price: 2_000_000, departure_dates: ['2026-05-01'] } as never,
      ],
    });
    expect(r).toHaveLength(1);
  });
});

describe('getStrictPriceDates — 폴백 없음', () => {
  it('price_dates 있으면 그대로', () => {
    const dates: PriceDate[] = [{ date: '2026-04-01', price: 1_000_000, confirmed: true }];
    expect(getStrictPriceDates({ price_dates: dates })).toBe(dates);
  });

  it('price_dates 없으면 [] (폴백 없음)', () => {
    // console.warn 가 발생하지만 빈 배열은 일관 보장
    expect(getStrictPriceDates({ id: 'pkg-1' })).toEqual([]);
  });
});

describe('tiersToDatePrices — tier → date 확장', () => {
  it('departure_dates 명시 배열', () => {
    const r = tiersToDatePrices([
      { period_label: '4월', adult_price: 1_000_000, departure_dates: ['2026-04-01', '2026-04-08'] } as never,
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].date).toBe('2026-04-01');
    expect(r[1].date).toBe('2026-04-08');
  });

  it('soldout tier 는 제외', () => {
    const r = tiersToDatePrices([
      { period_label: '4월', adult_price: 1_000_000, departure_dates: ['2026-04-01'], status: 'soldout' } as never,
    ]);
    expect(r).toEqual([]);
  });

  it('confirmed status 는 confirmed=true', () => {
    const r = tiersToDatePrices([
      { period_label: '4월', adult_price: 1_000_000, departure_dates: ['2026-04-01'], status: 'confirmed' } as never,
    ]);
    expect(r[0].confirmed).toBe(true);
  });

  it('note 에 "출확" 포함 → confirmed=true', () => {
    const r = tiersToDatePrices([
      { period_label: '4월', adult_price: 1_000_000, departure_dates: ['2026-04-08'], note: '출확' } as never,
    ]);
    expect(r[0].confirmed).toBe(true);
  });

  it('중복 날짜 제거', () => {
    const r = tiersToDatePrices([
      { period_label: '4월', adult_price: 1_000_000, departure_dates: ['2026-04-01', '2026-04-01'] } as never,
    ]);
    expect(r).toHaveLength(1);
  });

  it('date_range + departure_day_of_week 로 요일 확장', () => {
    // 2026-04-01(수), 2026-04-08(수), 2026-04-15(수), 2026-04-22(수), 2026-04-29(수)
    const r = tiersToDatePrices([
      {
        period_label: '4월',
        adult_price: 1_000_000,
        date_range: { start: '2026-04-01', end: '2026-04-30' },
        departure_day_of_week: '수',
      } as never,
    ]);
    expect(r.length).toBeGreaterThanOrEqual(4);
    // 모두 수요일인지 확인 (safeDayOfWeek 로 검증)
    for (const d of r) {
      const [y, m, day] = d.date.split('-').map(Number);
      expect(new Date(y, m - 1, day).getDay()).toBe(3); // 수=3
    }
  });

  it('excluded_dates 필터', () => {
    const r = tiersToDatePrices([
      {
        period_label: '4월',
        adult_price: 1_000_000,
        departure_dates: ['2026-04-01', '2026-04-08', '2026-04-15'],
        excluded_dates: ['2026-04-08'],
      } as never,
    ]);
    expect(r.map(d => d.date)).toEqual(['2026-04-01', '2026-04-15']);
  });

  it('결과가 날짜 오름차순으로 정렬', () => {
    const r = tiersToDatePrices([
      { period_label: 'A', adult_price: 1_000_000, departure_dates: ['2026-04-15', '2026-04-01', '2026-04-08'] } as never,
    ]);
    expect(r.map(d => d.date)).toEqual(['2026-04-01', '2026-04-08', '2026-04-15']);
  });
});

describe('groupForPoster — Strict Grouping', () => {
  it('빈 배열 → []', () => {
    expect(groupForPoster([])).toEqual([]);
  });

  it('월별 분리 + 같은 월/같은 가격/같은 요일 → 1 행으로 묶임', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-02', price: 1_000_000, confirmed: false }, // 목
      { date: '2026-04-09', price: 1_000_000, confirmed: false }, // 목
      { date: '2026-04-16', price: 1_000_000, confirmed: false }, // 목
    ];
    const r = groupForPoster(dates);
    expect(r).toHaveLength(1);
    expect(r[0].month).toBe('4월');
    expect(r[0].rows).toHaveLength(1);
    expect(r[0].rows[0].dow).toBe('목');
    expect(r[0].rows[0].dates.map(d => d.day)).toEqual([2, 9, 16]);
    expect(r[0].rows[0].price).toBe(1_000_000);
  });

  it('같은 가격이지만 요일 다르면 분리 행 (ERR-20260418-06 Strict)', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-05', price: 1_000_000, confirmed: false }, // 일
      { date: '2026-04-06', price: 1_000_000, confirmed: false }, // 월
    ];
    const r = groupForPoster(dates);
    expect(r[0].rows).toHaveLength(2);
    const dows = r[0].rows.map(row => row.dow);
    expect(dows).toContain('일');
    expect(dows).toContain('월');
    // 라벨에 "일-월" 같은 강제 병합 표기는 절대 없음
    expect(dows.every(d => d.length === 1)).toBe(true);
  });

  it('isLowest 플래그: 전체 최저가만 true', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-02', price: 1_500_000, confirmed: false },
      { date: '2026-04-09', price: 1_000_000, confirmed: false },
    ];
    const r = groupForPoster(dates);
    const allRows = r.flatMap(g => g.rows);
    expect(allRows.find(row => row.price === 1_000_000)?.isLowest).toBe(true);
    expect(allRows.find(row => row.price === 1_500_000)?.isLowest).toBe(false);
  });

  it('globalMinOverride: 청크 분할용 (ERR-20260418-29)', () => {
    const dates: PriceDate[] = [
      { date: '2026-05-02', price: 1_500_000, confirmed: false },
      { date: '2026-05-09', price: 1_700_000, confirmed: false },
    ];
    // 외부에서 알려준 진짜 globalMin = 1,200,000 → 이 청크 안 가격은 모두 not lowest
    const r = groupForPoster(dates, { globalMinOverride: 1_200_000 });
    const allRows = r.flatMap(g => g.rows);
    expect(allRows.every(row => row.isLowest === false)).toBe(true);
  });

  it('월 내 정렬: 날짜 오름차순 (ERR-HET-price-table-desc-order)', () => {
    const dates: PriceDate[] = [
      { date: '2026-08-26', price: 1_000_000, confirmed: false }, // 화 (싸짐)
      { date: '2026-08-05', price: 1_500_000, confirmed: false }, // 수
    ];
    const r = groupForPoster(dates);
    // 8/5 가 8/26 보다 먼저 나와야 함 (가격이 더 비쌌더라도)
    const firstRow = r[0].rows[0];
    expect(firstRow.dates[0].day).toBe(5);
  });

  it('confirmed 플래그 보존', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-02', price: 1_000_000, confirmed: true },
      { date: '2026-04-09', price: 1_000_000, confirmed: false },
    ];
    const r = groupForPoster(dates);
    const days = r[0].rows[0].dates;
    expect(days.find(d => d.day === 2)?.confirmed).toBe(true);
    expect(days.find(d => d.day === 9)?.confirmed).toBe(false);
  });

  it('다중 월 분리', () => {
    const dates: PriceDate[] = [
      { date: '2026-04-02', price: 1_000_000, confirmed: false },
      { date: '2026-05-07', price: 1_100_000, confirmed: false },
    ];
    const r = groupForPoster(dates);
    expect(r).toHaveLength(2);
    expect(r[0].month).toBe('4월');
    expect(r[1].month).toBe('5월');
  });
});

describe('getNextDepartureFromDates', () => {
  it('빈 배열 → null', () => {
    expect(getNextDepartureFromDates([])).toBeNull();
  });

  it('과거 날짜만 있으면 null', () => {
    const dates: PriceDate[] = [
      { date: '2020-01-01', price: 1_000_000, confirmed: true },
    ];
    expect(getNextDepartureFromDates(dates)).toBeNull();
  });

  it('미래 날짜 중 가장 가까운 것 반환', () => {
    const dates: PriceDate[] = [
      { date: '2099-12-31', price: 1_500_000, confirmed: false },
      { date: '2099-06-15', price: 1_000_000, confirmed: false },
    ];
    expect(getNextDepartureFromDates(dates)).toBe('2099-06-15');
  });
});
