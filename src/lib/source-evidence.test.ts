import { describe, expect, it } from 'vitest';
import { collectEvidenceForValues, evidenceCoverage, findEvidenceSpan, hashRawText } from './source-evidence';

describe('source-evidence', () => {
  const raw = '상품명: 나트랑/달랏 3박5일\n항공: LJ115 / LJ116\n최소 6명 이상\n성인 619,000원';

  it('finds exact source spans from raw text', () => {
    const span = findEvidenceSpan(raw, 'LJ116');
    expect(span?.quote).toBe('LJ116');
    expect(span?.rawTextHash).toBe(hashRawText(raw));
  });

  it('matches formatted numeric evidence in raw text', () => {
    const span = findEvidenceSpan(raw, 619000);
    expect(span?.quote).toBe('619,000');
  });

  it('collects evidence map for multiple fields', () => {
    const map = collectEvidenceForValues(raw, [
      ['meta.airline_in', 'LJ116'],
      ['meta.minParticipants', 6],
      ['priceGroups[0].adultPrice', '619,000'],
    ]);
    expect(map['meta.airline_in']?.[0]?.quote).toBe('LJ116');
    expect(map['meta.minParticipants']?.[0]?.quote).toBe('6명');
  });

  it('calculates coverage', () => {
    const coverage = evidenceCoverage({ a: [{ rawTextHash: 'h', start: 0, end: 1, quote: 'x', confidence: 1, source: 'raw' }] }, ['a', 'b']);
    expect(coverage.covered).toBe(1);
    expect(coverage.missing).toEqual(['b']);
  });
});
