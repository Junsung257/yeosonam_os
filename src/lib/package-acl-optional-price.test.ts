import { describe, expect, it } from 'vitest';
import { normalizeOptionalTour } from './package-acl';

describe('normalizeOptionalTour option price normalization', () => {
  it.each([
    ['USD30', '$30/인', 30],
    ['USD 30', '$30/인', 30],
    ['$30', '$30/인', 30],
    ['US$30/인', '$30/인', 30],
  ])('normalizes %s for customer mobile landing', (rawPrice, label, usd) => {
    const normalized = normalizeOptionalTour({ name: '발마사지30분', price: rawPrice });
    expect(normalized?.price).toBe(label);
    expect(normalized?.price_usd).toBe(usd);
    expect(normalized?.price_krw).toBeNull();
  });

  it.each([
    ['30000원', '30,000원', 30000],
    ['KRW30000', '30,000원', 30000],
    ['30,000 KRW', '30,000원', 30000],
  ])('normalizes %s into a Korean won customer label', (rawPrice, label, krw) => {
    const normalized = normalizeOptionalTour({ name: '현지 체험', price: rawPrice });
    expect(normalized?.price).toBe(label);
    expect(normalized?.price_krw).toBe(krw);
    expect(normalized?.price_usd).toBeNull();
  });
});
