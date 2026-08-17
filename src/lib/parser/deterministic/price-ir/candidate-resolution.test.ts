import { describe, expect, it } from 'vitest';

import {
  extractPriceIRCandidates,
  extractPriceIR,
  resolvePriceIRCandidates,
  type PriceIRCandidate,
} from './index';

function candidate(input: Partial<PriceIRCandidate> & Pick<PriceIRCandidate, 'source' | 'rows'>): PriceIRCandidate {
  return {
    tiers: [],
    specificity: 5,
    priority: 100,
    valid: true,
    issues: [],
    ...input,
  };
}

describe('price candidate graph resolution', () => {
  it('runs every deterministic extractor and retains rejected evidence candidates', () => {
    const rawText = [
      '출발일 2026-09-27',
      '1인 1,199,000원 → 1,039,000원',
      '상품가',
      '9/27',
      '1,039,000원',
    ].join('\n');

    const candidates = extractPriceIRCandidates(rawText, { year: 2026 });
    const result = extractPriceIR(rawText, { year: 2026 });

    expect(candidates.map(item => item.source)).toContain('commercial_price_relation');
    expect(candidates.length).toBeGreaterThan(1);
    expect(result.candidates?.length).toBe(candidates.length);
    expect(result.rows).toEqual([
      expect.objectContaining({ date: '2026-09-27', adult_price: 1_039_000 }),
    ]);
  });

  it('fails closed when equally authoritative candidates disagree on one sale scope', () => {
    const result = resolvePriceIRCandidates([
      candidate({
        source: 'explicit_date_weekday_price',
        rows: [{ date: '2026-09-27', adult_price: 899_000 }],
      }),
      candidate({
        source: 'labeled_date_list_price',
        rows: [{ date: '2026-09-27', adult_price: 999_000 }],
      }),
    ]);

    expect(result.source).toBe('none');
    expect(result.rows).toEqual([]);
    expect(result.resolution).toEqual(expect.objectContaining({ status: 'ambiguous' }));
    expect(result.resolution?.conflicts).toEqual([
      expect.objectContaining({ prices: [899_000, 999_000] }),
    ]);
  });

  it('allows a broader table only when it reproduces every higher-specificity seed', () => {
    const result = resolvePriceIRCandidates([
      candidate({
        source: 'explicit_date_weekday_price',
        specificity: 5,
        priority: 170,
        rows: [{ date: '2026-09-27', adult_price: 899_000 }],
      }),
      candidate({
        source: 'pdf_date_price_table',
        specificity: 2,
        priority: 90,
        rows: [
          { date: '2026-09-27', adult_price: 899_000 },
          { date: '2026-10-04', adult_price: 899_000 },
        ],
      }),
    ]);

    expect(result.source).toBe('pdf_date_price_table');
    expect(result.rows.map(row => row.date)).toEqual(['2026-09-27', '2026-10-04']);
    expect(result.resolution).toEqual(expect.objectContaining({ status: 'extended' }));
  });
});
