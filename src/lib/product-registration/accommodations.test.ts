import { describe, expect, it } from 'vitest';
import { inferAccommodationsFromRawText } from './accommodations';

describe('inferAccommodationsFromRawText', () => {
  it('recovers HOTEL marker rows including villa names', () => {
    expect(inferAccommodationsFromRawText(`
제1일
HOTEL: 휴젠 풀빌라 또는 동급 *1베드
제2일
HOTEL: 휴젠 풀빌라 또는 동급 *1베드
`)).toEqual(['휴젠 풀빌라 또는 동급 *1베드']);
  });
});
