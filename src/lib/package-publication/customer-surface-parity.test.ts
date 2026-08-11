import { describe, expect, it } from 'vitest';
import { evaluateCustomerSurfaceParity } from './customer-surface-parity';

describe('customer surface parity', () => {
  const base = {
    package: { id: 'pkg-1', title: '도쿄 핵심관광', destination: '도쿄', price: 999000, duration: 4 },
    cardProjection: { id: 'pkg-1', title: '도쿄 핵심관광', destination: '도쿄', price: 999000, duration: 4, hero_image_url: 'https://cdn.example/a.jpg' },
    lpProjection: { id: 'pkg-1', title: '도쿄 핵심관광', destination: '도쿄', price: 999000, duration: 4, hero_image_url: 'https://cdn.example/a.jpg' },
  };

  it('accepts identical customer identity fields', () => {
    expect(evaluateCustomerSurfaceParity(base)).toEqual({ ok: true, findings: [] });
  });

  it('blocks a price or hero mismatch between card and landing', () => {
    const result = evaluateCustomerSurfaceParity({
      ...base,
      lpProjection: { ...base.lpProjection, price: 1099000, hero_image_url: 'https://cdn.example/b.jpg' },
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map(item => item.code)).toEqual(expect.arrayContaining([
      'customer_surface_price_mismatch',
      'customer_surface_image_mismatch',
    ]));
  });

  it('normalizes presentation whitespace before comparison', () => {
    const result = evaluateCustomerSurfaceParity({
      ...base,
      cardProjection: { ...base.cardProjection, title: '  도쿄   핵심관광\n' },
    });
    expect(result.ok).toBe(true);
  });
});
