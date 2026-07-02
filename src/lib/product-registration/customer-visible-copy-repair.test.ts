import { describe, expect, it } from 'vitest';

import { auditCustomerVisibleProductText, blockingCustomerVisibleTextIssues } from '@/lib/customer-visible-text-audit';
import { repairCustomerVisibleCopyPayload } from './customer-visible-copy-repair';

describe('repairCustomerVisibleCopyPayload', () => {
  it('normalizes safe supplier copy without dropping the product payload', () => {
    const result = repairCustomerVisibleCopyPayload({
      excludes: ['RMK 불포함 / P.P $60 / \\90,000 추가 됩니다'],
    });

    expect(result.value).toEqual({
      excludes: ['참고사항 불포함 / 1인 $60 / 90,000원 추가됩니다'],
    });
    expect(blockingCustomerVisibleTextIssues(result.value)).toEqual([]);
  });

  it('removes only unsafe schedule items and keeps usable itinerary rows', () => {
    const result = repairCustomerVisibleCopyPayload({
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '랜드사 NET 기준으로 마진 확인 후 담당자 확인', type: 'normal' },
              { activity: '다낭 시내 관광', type: 'attraction' },
              { activity: '????', type: 'normal' },
            ],
          },
        ],
      },
    });

    expect(result.value).toEqual({
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '다낭 시내 관광', type: 'attraction' },
            ],
          },
        ],
      },
    });
    expect(blockingCustomerVisibleTextIssues(result.value)).toEqual([]);
  });

  it('normalizes duplicated inclusions/options while preserving source evidence and core fields', () => {
    const result = repairCustomerVisibleCopyPayload({
      title: '다낭 바나힐 패키지',
      price_dates: [{ date: '2026-07-01', price: 899000 }],
      itinerary_data: {
        highlights: {
          inclusions: ['특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)'],
        },
        evidence: { quote: '바나산 정산 원문 근거' },
      },
      inclusions: [
        '특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)',
        '특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)',
      ],
      optional_tours: [
        { name: '특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)' },
      ],
    });

    expect(result.value).toMatchObject({
      title: '다낭 바나힐 패키지',
      price_dates: [{ date: '2026-07-01', price: 899000 }],
    });
    expect((result.value as { inclusions: string[] }).inclusions).toEqual([
      '특식 – 바나산 정상 레스토랑에서 저녁식사(맥주 또는 음료 1잔)',
    ]);
    expect((result.value as { optional_tours: unknown[] }).optional_tours).toEqual([]);
    expect(JSON.stringify(result.value)).toContain('바나산 정상');
    expect(JSON.stringify(result.value)).toContain('바나산 정산 원문 근거');
    expect(auditCustomerVisibleProductText(result.value as Record<string, unknown>).filter(issue => !issue.safeFixable)).toEqual([]);
  });

  it('removes highlight duplicates when the same customer copy exists in top-level sections', () => {
    const result = repairCustomerVisibleCopyPayload({
      itinerary_data: {
        highlights: {
          inclusions: ['왕복 항공료 및 유류할증료', '전 일정 식사'],
          remarks: ['전 일정 식사'],
        },
      },
      inclusions: ['왕복 항공료 및 유류할증료', '전 일정 식사'],
    });

    expect((result.value as { itinerary_data: { highlights: { inclusions: unknown[]; remarks: unknown[] } } }).itinerary_data.highlights.inclusions).toEqual([]);
    expect((result.value as { itinerary_data: { highlights: { inclusions: unknown[]; remarks: unknown[] } } }).itinerary_data.highlights.remarks).toEqual([]);
    expect((result.value as { inclusions: string[] }).inclusions).toEqual(['왕복 항공료 및 유류할증료', '전 일정 식사']);
  });

  it('removes repeated optional tour notes while preserving each tour name', () => {
    const result = repairCustomerVisibleCopyPayload({
      optional_tours: [
        { name: '5D 영화관', note: '요금: 성인 $40, 아동 $40' },
        { name: 'VIP 마사지', note: '요금: 성인 $40, 아동 $40' },
      ],
    });

    expect((result.value as { optional_tours: Array<{ name: string; note?: string }> }).optional_tours).toEqual([
      { name: '5D 영화관', note: '요금: 성인 $40, 아동 $40' },
      { name: 'VIP 마사지' },
    ]);
  });

  it('preserves required nullable fields inside structured price rows', () => {
    const result = repairCustomerVisibleCopyPayload({
      product_prices: [{
        target_date: '2026-07-23',
        day_of_week: null,
        net_price: 529000,
        adult_selling_price: null,
        child_price: null,
        note: null,
      }],
      price_dates: [{
        date: '2026-07-23',
        price: 529000,
        child_price: null,
        confirmed: null,
      }],
      price_tiers: [{
        period_label: '2026-07-23',
        departure_dates: ['2026-07-23'],
        departure_day_of_week: null,
        adult_price: 529000,
        child_price: null,
        infant_price: null,
        note: null,
      }],
    });

    expect(result.value).toMatchObject({
      product_prices: [{
        target_date: '2026-07-23',
        day_of_week: null,
        net_price: 529000,
        adult_selling_price: null,
        child_price: null,
        note: null,
      }],
      price_dates: [{
        date: '2026-07-23',
        price: 529000,
        child_price: null,
        confirmed: null,
      }],
      price_tiers: [{
        period_label: '2026-07-23',
        departure_dates: ['2026-07-23'],
        departure_day_of_week: null,
        adult_price: 529000,
        child_price: null,
        infant_price: null,
        note: null,
      }],
    });
  });
});
