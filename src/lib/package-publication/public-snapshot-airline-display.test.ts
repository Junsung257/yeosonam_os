import { describe, expect, it } from 'vitest';

import { buildPublicPackageSnapshot } from './public-snapshot';

describe('public package snapshot airline display', () => {
  it('normalizes isolated supplier airline codes before route text is exposed', () => {
    const { snapshot } = buildPublicPackageSnapshot({
      id: 'pkg-airline-display',
      title: '[LJ] 다낭/호이안 노팁노옵션 3박5일',
      display_title: '[LJ] 다낭/호이안 노팁노옵션 3박5일',
      destination: '다낭/호이안',
      duration: 5,
      nights: 3,
      airline: 'LJ',
      raw_text: [
        '항공 LJ 진에어',
        '출발일 2026년 8월 1일 상품가 599,000원/인',
        'DAY 1 부산 출발 후 다낭 도착',
        'DAY 2 호이안 관광',
      ].join('\n'),
      price_dates: [{ date: '2026-08-01', adult_selling_price: 599000 }],
      inclusions: ['왕복항공료', '숙박료'],
      excludes: ['개인경비'],
      optional_tours: ['노옵션'],
      product_highlights: ['LJ 항공 이용', '7C 항공 탑승', 'UO'],
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '부산 출발 후 다낭 도착' }] },
          { day: 2, schedule: [{ activity: '호이안 관광' }] },
        ],
      },
    });

    const routeText = snapshot.route_text_dump.join('\n');
    expect(routeText).toContain('진에어 이용');
    expect(routeText).toContain('제주항공 이용');
    expect(routeText).toContain('홍콩익스프레스');
    expect(routeText).not.toMatch(/(^|[^A-Z0-9])(?:LJ|7C|UO)(?!\d|[A-Z0-9])/);
  });
});
