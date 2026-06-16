import { describe, expect, it } from 'vitest';
import { formatProductTypeLabel } from './product-type-label';

describe('formatProductTypeLabel', () => {
  it('maps internal product type codes to customer-facing Korean labels', () => {
    expect(formatProductTypeLabel('golf')).toBe('골프');
    expect(formatProductTypeLabel('cruise')).toBe('크루즈');
    expect(formatProductTypeLabel('ferry')).toBe('선박');
  });

  it('keeps already customer-facing labels', () => {
    expect(formatProductTypeLabel('골프')).toBe('골프');
    expect(formatProductTypeLabel('노쇼핑')).toBe('노쇼핑');
  });

  it('returns null for empty labels', () => {
    expect(formatProductTypeLabel(null)).toBeNull();
    expect(formatProductTypeLabel('   ')).toBeNull();
  });
});
