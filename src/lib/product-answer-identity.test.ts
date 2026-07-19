import { describe, expect, it } from 'vitest';
import { buildProductAnswerIdentity } from './product-answer-identity';

describe('buildProductAnswerIdentity', () => {
  it('keeps duplicate product titles distinguishable through public codes and facts', () => {
    const first = buildProductAnswerIdentity({
      id: 'a',
      title: 'Yanji Baekdusan North Slope 2 nights 3 days',
      short_code: 'ETC-YNJ-03-04',
      destination: 'Yanji/Baekdusan',
      country: 'China',
      airline: 'BX',
      duration: 3,
      product_type: 'Crown',
      trip_style: 'North Slope',
      price_dates: [{ date: '2026-07-03', price: 979000 }],
    });
    const second = buildProductAnswerIdentity({
      id: 'b',
      title: 'Yanji Baekdusan North Slope 2 nights 3 days',
      short_code: 'ETC-YNJ-03-05',
      destination: 'Yanji/Baekdusan',
      country: 'China',
      airline: 'BX',
      duration: 3,
      product_type: 'Save',
      trip_style: 'North Slope',
      price_dates: [{ date: '2026-07-03', price: 979000 }],
    });

    expect(first.baseTitle).toBe(second.baseTitle);
    expect(first.key).not.toBe(second.key);
    expect(first.label).toContain('ETC-YNJ-03-04');
    expect(second.label).toContain('ETC-YNJ-03-05');
  });

  it('falls back to a stable id when no public code exists', () => {
    const identity = buildProductAnswerIdentity({
      id: 'fallback-id',
      title: 'No code product',
      destination: 'Danang',
    });

    expect(identity.key).toContain('fallback-id');
    expect(identity.label).toContain('fallback-id');
  });
});
