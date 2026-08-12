import { describe, expect, it } from 'vitest';

import { extractOcrCriticalTokens, ocrCriticalTokensMatch } from './ocr-providers';

describe('OCR critical-value cross validation', () => {
  it('extracts price, departure date and flight number tokens', () => {
    expect(extractOcrCriticalTokens('출발 2026-09-19 BX321 성인 599,000원')).toEqual([
      '2026-09-19',
      '599,000원',
      'BX321',
    ]);
  });

  it('rejects a one-digit price disagreement even when the rest matches', () => {
    expect(ocrCriticalTokensMatch(
      extractOcrCriticalTokens('2026-09-19 BX321 599,000원'),
      extractOcrCriticalTokens('2026-09-19 BX321 699,000원'),
    )).toBe(false);
  });

  it('ignores provider token ordering but not token content', () => {
    expect(ocrCriticalTokensMatch(
      ['BX321', '599,000원', '2026-09-19'],
      ['2026-09-19', 'BX321', '599,000원'],
    )).toBe(true);
  });
});
