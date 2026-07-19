import { describe, expect, it } from 'vitest';

import { composeCustomerPublicSubtitle, composeCustomerPublicSummary } from './public-summary-policy';
import { buildPublicPackageSnapshot } from './public-snapshot';

describe('customer public summary policy', () => {
  it('generates a customer-readable summary from public title and evidence-backed fields', () => {
    const summary = composeCustomerPublicSummary({
      publicTitle: '다낭·호이안 노팁·노옵션 휴양관광 3박5일',
      optionBadges: ['노팁·노옵션'],
      optionalTourStatus: 'none_explicit',
      pkg: {
        price_dates: [{ date: '2026-08-01', price: 799000 }],
        inclusions: ['왕복항공', '숙박', '식사'],
        airline: '진에어',
        itinerary_data: { days: [{ day: 1, schedule: [{ activity: '호이안 야경 관광' }] }] },
      },
    });

    expect(summary).toBe(
      '다낭·호이안 노팁·노옵션 휴양관광 3박5일 상품입니다. 노팁·노옵션 조건과 일정·가격·항공·포함 사항을 상담 전에 한눈에 확인할 수 있어요.',
    );
  });

  it('builds a concise subtitle from verified conditions and available fields', () => {
    const subtitle = composeCustomerPublicSubtitle({
      publicTitle: '연길·백두산 노옵션 핵심관광 4박5일',
      optionBadges: ['노옵션'],
      optionalTourStatus: 'none_explicit',
      pkg: {
        price_dates: [{ date: '2026-07-12', price: 599000 }],
        itinerary_data: { days: [{ day: 1, schedule: [] }] },
      },
    });

    expect(subtitle).toBe('노옵션 조건 · 일정·가격 확인');
  });

  it('does not copy risky or internal supplier summaries into the public snapshot', () => {
    const { snapshot } = buildPublicPackageSnapshot({
      id: 'summary-golden',
      package_revision: 1,
      destination: '다낭/호이안',
      title: '[LJ] 다낭/호이안 노팁노옵션 3박5일 출발확정',
      product_summary: '예약 즉시 항공·숙박 확보 / 관리자노트: 랜드사 커미션 확인',
      duration: 5,
      nights: 3,
      raw_text: '노팁 노옵션 조건. 호이안 야경 관광과 리조트 휴양 일정 포함.',
      price_dates: [{ date: '2026-08-01', price: 799000 }],
      product_prices: [{ target_date: '2026-08-01', adult_selling_price: 799000 }],
      inclusions: ['왕복항공', '숙박', '식사'],
      products: {
        thumbnail_urls: ['https://cdn.yeosonam.com/packages/danang.jpg'],
      },
      itinerary_data: { days: [{ day: 1, schedule: [{ activity: '호이안 야경 관광' }] }] },
    });

    expect(snapshot.lp_projection.summary).toBe(
      '다낭·호이안 노팁·노옵션 휴양관광 3박5일 상품입니다. 노팁·노옵션 조건과 일정·가격·포함 사항을 상담 전에 한눈에 확인할 수 있어요.',
    );
    expect(snapshot.route_text_dump.join('\n')).not.toMatch(/예약 즉시|확보|관리자노트|커미션|LJ|출발확정/);
  });
});
