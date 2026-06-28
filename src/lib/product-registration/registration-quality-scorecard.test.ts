import { describe, expect, it } from 'vitest';

import { evaluateRegistrationQualityScorecard } from './registration-quality-scorecard';

const validPackage = {
  id: 'pkg-1',
  internal_code: 'PUS-TEST-001',
  title: '다낭 3박 5일',
  destination: '다낭',
  raw_text: '상품 원문 '.repeat(20),
  airline: 'BX',
  itinerary_data: {
    days: [
      { day: 1, schedule: [{ activity: '공항 미팅' }], hotel: { name: '다낭 호텔' } },
      { day: 2, schedule: [{ activity: '바나힐 관광' }], hotel: { name: '다낭 호텔' } },
    ],
  },
  price_dates: [{ date: '2099-07-01', price: 899000 }],
};

const productPrices = [
  {
    target_date: '2099-07-01',
    net_price: 899000,
    adult_selling_price: 899000,
  },
];

const mobileProof = {
  ok: true,
  reason: 'actual /packages and /lp mobile browser proof passed',
  proof: {
    status: 'pass',
    checked_at: '2099-06-01T00:00:00.000Z',
    surfaces: ['packages', 'lp'],
    surface_results: [
      { surface: 'packages', status: 'pass' },
      { surface: 'lp', status: 'pass' },
    ],
  },
};

describe('evaluateRegistrationQualityScorecard', () => {
  it('marks a fully proven registration as a customer open candidate', () => {
    const scorecard = evaluateRegistrationQualityScorecard({
      pkg: validPackage,
      verifyChecks: [
        { id: 'C15', status: 'pass', detail: 'no pending entities' },
        { id: 'C18', status: 'pass', detail: 'customer visible text clean' },
      ],
      productPrices,
      mobileProof,
      learning: { micro: 100, macro: 100, combined: 100, productionReady: true, blockers: [] },
    });

    expect(scorecard.customerOpenCandidate).toBe(true);
    expect(scorecard.minScore).toBeGreaterThanOrEqual(95);
    expect(scorecard.averageScore).toBeGreaterThanOrEqual(97);
  });

  it('fails both customer mobile domains when proof is missing', () => {
    const scorecard = evaluateRegistrationQualityScorecard({
      pkg: validPackage,
      verifyChecks: [{ id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof: null,
      learning: { micro: 100, macro: 100, combined: 100, productionReady: true, blockers: [] },
    });

    expect(scorecard.customerOpenCandidate).toBe(false);
    expect(scorecard.domains.find(domain => domain.id === 'packages_mobile')?.score).toBe(0);
    expect(scorecard.domains.find(domain => domain.id === 'lp_mobile')?.score).toBe(0);
  });

  it('fails price and DB consistency when price_dates diverge from product_prices', () => {
    const scorecard = evaluateRegistrationQualityScorecard({
      pkg: { ...validPackage, price_dates: [{ date: '2099-07-01', price: 999000 }] },
      verifyChecks: [{ id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof,
      learning: { micro: 100, macro: 100, combined: 100, productionReady: true, blockers: [] },
    });

    expect(scorecard.customerOpenCandidate).toBe(false);
    expect(scorecard.domains.find(domain => domain.id === 'price_dates')?.blockers.join(' ')).toContain('product_prices min');
    expect(scorecard.domains.find(domain => domain.id === 'db_consistency')?.score).toBe(0);
  });

  it('fails customer copy when the residual customer text gate fails', () => {
    const scorecard = evaluateRegistrationQualityScorecard({
      pkg: validPackage,
      verifyChecks: [{ id: 'C18', status: 'fail', detail: 'internal supplier text leaked' }],
      productPrices,
      mobileProof,
      learning: { micro: 100, macro: 100, combined: 100, productionReady: true, blockers: [] },
    });

    expect(scorecard.customerOpenCandidate).toBe(false);
    expect(scorecard.domains.find(domain => domain.id === 'customer_copy')?.score).toBe(0);
  });
});
