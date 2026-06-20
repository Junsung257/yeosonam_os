import { describe, expect, it } from 'vitest';
import { normalizeDepartureHub } from './departure-hub';

describe('normalizeDepartureHub', () => {
  it('maps Korean departure city query values to hub ids', () => {
    expect(normalizeDepartureHub('부산')).toBe('busan');
    expect(normalizeDepartureHub('김해')).toBe('busan');
    expect(normalizeDepartureHub('인천')).toBe('incheon');
    expect(normalizeDepartureHub('대구')).toBe('daegu');
    expect(normalizeDepartureHub('청주')).toBe('cheongju');
    expect(normalizeDepartureHub('전국')).toBe('all');
  });

  it('keeps existing English and airport-code aliases working', () => {
    expect(normalizeDepartureHub('ICN')).toBe('incheon');
    expect(normalizeDepartureHub('TAE')).toBe('daegu');
    expect(normalizeDepartureHub('CJJ')).toBe('cheongju');
    expect(normalizeDepartureHub('nationwide')).toBe('all');
  });
});
