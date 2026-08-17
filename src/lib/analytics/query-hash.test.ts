import { describe, expect, it } from 'vitest';
import { hashAnalyticsSearchQuery } from './query-hash';

describe('analytics search query hashing', () => {
  it('normalizes equivalent queries without retaining the raw value', () => {
    const first = hashAnalyticsSearchQuery('  오사카   숙소 위치 ');
    const second = hashAnalyticsSearchQuery('오사카 숙소 위치');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('오사카');
  });

  it('does not invent a hash for a missing query', () => {
    expect(hashAnalyticsSearchQuery(null)).toBeNull();
    expect(hashAnalyticsSearchQuery('   ')).toBeNull();
  });
});
