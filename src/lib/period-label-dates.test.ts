import { describe, expect, it } from 'vitest';
import { hydratePriceTiers, parsePeriodLabelToDates } from '@/lib/period-label-dates';
import { tiersToDatePrices } from '@/lib/price-dates';

describe('parsePeriodLabelToDates', () => {
  it('M/D,D 목록', () => {
    const dates = parsePeriodLabelToDates('4/1,2,9,22 3박', { year: 2026 });
    expect(dates).toEqual(['2026-04-01', '2026-04-02', '2026-04-09', '2026-04-22']);
  });

  it('M/D~M/D + 요일', () => {
    const dates = parsePeriodLabelToDates('5/1~7/14', {
      year: 2026,
      departureDayOfWeek: '일,월,화,토',
    });
    expect(dates.length).toBeGreaterThan(10);
    expect(dates.every(d => d.startsWith('2026-'))).toBe(true);
  });

  it('M/D~M/D 기간 (요일 없음)', () => {
    const dates = parsePeriodLabelToDates('2/28~3/10 연휴제외', { year: 2026 });
    expect(dates.length).toBeGreaterThan(5);
    expect(dates[0]).toBe('2026-02-28');
  });

  it('요금표 참조 → 빈 배열', () => {
    expect(parsePeriodLabelToDates('요금표 참조')).toEqual([]);
  });
});

describe('hydratePriceTiers + tiersToDatePrices', () => {
  it('legacy label-only tier', () => {
    const tiers = [{
      period_label: '4/1,2,9,22 3박',
      adult_price: 419000,
      status: 'available',
    }] as never[];
    const hydrated = hydratePriceTiers(tiers);
    expect(hydrated[0].departure_dates?.length).toBe(4);
    const dates = tiersToDatePrices(hydrated);
    expect(dates).toHaveLength(4);
    expect(dates[0].price).toBe(419000);
  });
});
