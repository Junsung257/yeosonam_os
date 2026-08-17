import { describe, expect, it } from 'vitest';

import { buildCustomerBudget } from './customer-budget';

describe('buildCustomerBudget', () => {
  it('adds only a fixed excluded fuel surcharge and never adds an excluded guide fee', () => {
    expect(buildCustomerBudget({
      baseProductPrice: 599_000,
      inclusions: ['왕복 항공료', '숙박'],
      exclusions: ['유류할증료 126,000원', '기사/가이드경비 40,000원'],
    })).toEqual({
      currency: 'KRW',
      base_product_price: 599_000,
      fuel_surcharge: {
        status: 'excluded_fixed',
        amount: 126_000,
        source_text: '유류할증료 126,000원',
      },
      expected_budget: 725_000,
      expected_budget_display: '725,000원',
      calculation: 'base_plus_fuel',
      guide_fee_excluded: true,
      guide_fee_source_text: '기사/가이드경비 40,000원',
    });
  });

  it('keeps the expected budget equal to the base price when fuel is included', () => {
    const result = buildCustomerBudget({
      baseProductPrice: 599_000,
      inclusions: ['왕복 항공료, TAX, 유류할증료 포함'],
      exclusions: ['가이드비 $50/인'],
    });

    expect(result.fuel_surcharge.status).toBe('included');
    expect(result.expected_budget).toBe(599_000);
    expect(result.guide_fee_excluded).toBe(true);
  });

  it('does not invent a total when an excluded fuel surcharge has no fixed amount', () => {
    const result = buildCustomerBudget({
      baseProductPrice: 599_000,
      inclusions: [],
      exclusions: ['유류할증료 변동분 별도', '가이드비 40,000원'],
    });

    expect(result.fuel_surcharge).toMatchObject({ status: 'excluded_unpriced', amount: null });
    expect(result.expected_budget).toBeNull();
    expect(result.calculation).toBe('fuel_confirmation_required');
  });

  it('does not calculate a total when fuel is both included and excluded', () => {
    const result = buildCustomerBudget({
      baseProductPrice: 599_000,
      inclusions: ['왕복 항공료, TAX, 유류할증료 포함'],
      exclusions: ['유류할증료 126,000원 별도'],
    });

    expect(result.fuel_surcharge).toEqual({
      status: 'conflicting',
      amount: null,
      source_text: '왕복 항공료, TAX, 유류할증료 포함 / 유류할증료 126,000원 별도',
    });
    expect(result.expected_budget).toBeNull();
    expect(result.calculation).toBe('fuel_confirmation_required');
  });

  it('does not treat a guide-only exclusion as part of the customer budget', () => {
    const result = buildCustomerBudget({
      baseProductPrice: 599_000,
      inclusions: ['항공', '숙박'],
      exclusions: ['가이드비 40,000원'],
    });

    expect(result.fuel_surcharge.status).toBe('not_stated');
    expect(result.expected_budget).toBe(599_000);
    expect(result.guide_fee_excluded).toBe(true);
  });
});
