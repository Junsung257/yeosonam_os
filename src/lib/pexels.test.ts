import { describe, expect, it } from 'vitest';

import { destToEnKeyword } from './pexels';

describe('destToEnKeyword', () => {
  it('uses an exact curated query for composite destinations', () => {
    expect(destToEnKeyword('천진/진황도')).toBe('Tianjin Qinhuangdao China coast city');
    expect(destToEnKeyword('삿포로/니세코')).toBe('Sapporo Niseko Hokkaido Japan winter mountains');
  });

  it('has curated English queries for the image-missing upload destinations', () => {
    const destinations = [
      '클락',
      '석가장',
      '방콕',
      '치앙마이',
      '나리타',
      '시즈오카',
      '오사카',
      '코타키나발루',
      '심양',
      '가오슝',
      '괌',
    ];
    for (const destination of destinations) {
      expect(destToEnKeyword(destination)).not.toContain(destination);
    }
  });
});
