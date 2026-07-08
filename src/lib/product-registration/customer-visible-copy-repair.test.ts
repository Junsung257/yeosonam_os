import { describe, expect, it } from 'vitest';

import { auditCustomerVisibleProductText, blockingCustomerVisibleTextIssues } from '@/lib/customer-visible-text-audit';
import { repairCustomerVisibleCopyPayload } from './customer-visible-copy-repair';

describe('repairCustomerVisibleCopyPayload', () => {
  it('normalizes safe supplier copy without dropping the product payload', () => {
    const result = repairCustomerVisibleCopyPayload({
      excludes: ['RMK 불포함 / P.P $60 / \\90,000 추가 합니다'],
    });

    expect(result.value).toEqual({
      excludes: ['참고사항 불포함 / 1인 $60 / 90,000원 추가합니다'],
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
          inclusions: ['특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔'],
        },
        evidence: { quote: '바나산 정산 원문 근거' },
      },
      inclusions: [
        '특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔',
        '특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔',
      ],
      optional_tours: [
        { name: '특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔' },
      ],
    });

    expect(result.value).toMatchObject({
      title: '다낭 바나힐 패키지',
      price_dates: [{ date: '2026-07-01', price: 899000 }],
    });
    expect((result.value as { inclusions: string[] }).inclusions).toEqual([
      '특식 - 바나산 정상 레스토랑에서 저녁식사 맥주 또는 음료 1잔',
    ]);
    expect((result.value as { optional_tours: unknown[] }).optional_tours).toEqual([]);
    expect(JSON.stringify(result.value)).toContain('바나산 정상');
    expect(JSON.stringify(result.value)).toContain('바나산 정산 원문 근거');
    expect(auditCustomerVisibleProductText(result.value as Record<string, unknown>).filter(issue => !issue.safeFixable)).toEqual([]);
  });

  it('removes highlight duplicates when the same customer copy exists in top-level sections', () => {
    const result = repairCustomerVisibleCopyPayload({
      product_highlights: ['[나트랑+달랏] 품격PKG 3박5일'],
      itinerary_data: {
        highlights: {
          inclusions: ['왕복 항공료 및 유류할증료', '전 일정 식사'],
          remarks: ['전 일정 식사', '[나트랑+달랏] 품격PKG 3박5일'],
        },
      },
      inclusions: ['왕복 항공료 및 유류할증료', '전 일정 식사'],
    });

    expect((result.value as { itinerary_data: { highlights: { inclusions: unknown[]; remarks: unknown[] } } }).itinerary_data.highlights.inclusions).toEqual([]);
    expect((result.value as { itinerary_data: { highlights: { inclusions: unknown[]; remarks: unknown[] } } }).itinerary_data.highlights.remarks).toEqual([]);
    expect((result.value as { inclusions: string[] }).inclusions).toEqual(['왕복 항공료 및 유류할증료', '전 일정 식사']);
  });

  it('removes top-level product highlights duplicated from customer title copy', () => {
    const result = repairCustomerVisibleCopyPayload({
      title: '나트랑/달랏 전일정 5성 실속 3박5일 일정표',
      display_title: '나트랑/달랏 전일정 5성 실속 3박5일',
      product_highlights: [
        '[BX] 나트랑/달랏 전일정 5성 실속 3박5일 &#9745;일정표',
        '달랏과 나트랑을 한 번에 둘러보는 일정',
      ],
    });

    expect((result.value as { product_highlights: string[] }).product_highlights).toEqual([
      '달랏과 나트랑을 한 번에 둘러보는 일정',
    ]);
    expect(auditCustomerVisibleProductText(result.value as Record<string, unknown>)).toEqual([]);
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

  it('removes risky promise copy without inventing replacement claims', () => {
    const result = repairCustomerVisibleCopyPayload({
      title: '연길·백두산 2명부터 출발확정 4박5일',
      hero_tagline: '예약 즉시 항공·숙박 확보 가능',
      itinerary_data: {
        meta: {
          title: '6/11(목) 까지 항공권 발권조건 2명부터 출발확정',
        },
      },
      customer_notes: '확정 또는 가능 출발일에서 선택하세요.',
    });

    expect(result.value).toMatchObject({
      title: '연길·백두산 4박5일',
      customer_notes: '예약 가능 출발일에서 선택하세요',
    });
    expect(JSON.stringify(result.value)).not.toContain('출발확정');
    expect(JSON.stringify(result.value)).not.toContain('예약 즉시');
    expect(result.changes.map(change => change.codes)).toContainEqual(['risky_customer_promise_copy']);
    expect(auditCustomerVisibleProductText(result.value as Record<string, unknown>)).toEqual([]);
  });

  it('keeps only priced public optional tours and removes table fragments', () => {
    const result = repairCustomerVisibleCopyPayload({
      optional_tours: [
        { name: '\ub178\uc635\uc158' },
        { name: '\uc624\uc804\uc790\uc720' },
        { name: '599' },
        { name: '\ucc28\ub7c9' },
        { name: '\uc120\ud0dd\uad00\uad11 \ud638\ud551\ud22c\uc5b4', price: '$80/\uc778' },
      ],
    });

    expect(result.value).toEqual({
      optional_tours: [
        { name: '\uc120\ud0dd\uad00\uad11 \ud638\ud551\ud22c\uc5b4', price: '$80/\uc778' },
      ],
    });
    expect(result.changes.map(change => change.codes[0])).toEqual(expect.arrayContaining([
      'optional_tour_no_option_evidence',
      'optional_tour_unknown_fragment',
      'optional_tour_price_table_fragment',
      'optional_tour_inclusion_fragment',
    ]));
  });
});
