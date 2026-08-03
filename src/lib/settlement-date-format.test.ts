import { describe, expect, it } from 'vitest';

import { formatSettlementTimestamp } from './settlement-date-format';

describe('formatSettlementTimestamp', () => {
  it('always renders bank timestamps in Korea time', () => {
    expect(formatSettlementTimestamp('2026-08-03T01:30:00.000Z')).toBe('08-03 10:30');
    expect(formatSettlementTimestamp('2026-08-03T10:30:00+09:00', { includeSeconds: true }))
      .toBe('08-03 10:30:00');
    expect(formatSettlementTimestamp('2026-08-03T01:30:00.000Z', { includeYear: true }))
      .toBe('2026-08-03 10:30');
  });

  it('returns an empty label for missing or invalid input', () => {
    expect(formatSettlementTimestamp(null)).toBe('');
    expect(formatSettlementTimestamp('not-a-date')).toBe('');
  });
});
