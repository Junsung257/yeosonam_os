import { describe, expect, it } from 'vitest';

import { koreaTimeDifferenceMinutes } from './TimezoneCard';

describe('customer timezone comparison', () => {
  it('converts an absolute UTC offset into a Korea-relative difference', () => {
    expect(koreaTimeDifferenceMinutes(8 * 60)).toBe(-60);
    expect(koreaTimeDifferenceMinutes(9 * 60)).toBe(0);
    expect(koreaTimeDifferenceMinutes(10 * 60)).toBe(60);
  });

  it('never describes Kota Kinabalu UTC+8 as eight hours ahead of Korea', () => {
    expect(koreaTimeDifferenceMinutes(480)).toBe(-60);
  });
});
