import { describe, expect, it } from 'vitest';

import {
  customerAirlineDisplayName,
  normalizeCustomerAirlineCodeCopy,
} from './airline-display';

describe('customer airline display normalization', () => {
  it('maps supplier airline codes to customer-readable carrier names', () => {
    expect(customerAirlineDisplayName('LJ')).toBe('진에어');
    expect(customerAirlineDisplayName('BX')).toBe('에어부산');
    expect(customerAirlineDisplayName('7C')).toBe('제주항공');
    expect(customerAirlineDisplayName('UO')).toBe('홍콩익스프레스');
  });

  it('normalizes isolated airline code copy without deleting flight numbers', () => {
    expect(normalizeCustomerAirlineCodeCopy('LJ 항공 이용')).toBe('진에어 이용');
    expect(normalizeCustomerAirlineCodeCopy('BX 이용 · 7C 항공 탑승 · UO')).toBe('에어부산 이용 · 제주항공 이용 · 홍콩익스프레스');
    expect(normalizeCustomerAirlineCodeCopy('LJ115 부산 출발')).toBe('LJ115 부산 출발');
  });
});
