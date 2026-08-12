import { describe, expect, it } from 'vitest';

import { financeCountBucket } from '@/lib/finance-analytics';

describe('finance analytics privacy buckets', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [5, '2-5'],
    [20, '6-20'],
    [21, '21+'],
  ])('buckets %s without exposing exact high counts', (value, expected) => {
    expect(financeCountBucket(value)).toBe(expected);
  });
});
