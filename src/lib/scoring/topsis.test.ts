import { describe, it, expect } from 'vitest';
import { topsis, entropyWeights, combineBwmEntropy } from './topsis';

describe('topsis', () => {
  it('all-benefit — best on every axis wins', () => {
    const { ranks } = topsis({
      matrix: [[5, 5], [3, 3], [1, 1]],
      weights: [0.5, 0.5],
      types: ['benefit', 'benefit'],
    });
    expect(ranks[0]).toBe(1);
    expect(ranks[2]).toBe(3);
  });

  it('cost criterion — lower wins', () => {
    const { ranks } = topsis({
      matrix: [[100], [50], [200]],
      weights: [1],
      types: ['cost'],
    });
    expect(ranks[1]).toBe(1);
    expect(ranks[2]).toBe(3);
  });

  it('mixed — Da Nang case (effective price + hotel + meal + freeOpt + -shop)', () => {
    // A: 322k/3.0성/5식/1옵션/3쇼핑
    // B: 298k/4.0성/6식/2옵션/2쇼핑
    // C: 150k/5.0성/7식/4옵션/0쇼핑
    const { ranks, scores } = topsis({
      matrix: [
        [322000, 3.0, 5, 1, -3],
        [298000, 4.0, 6, 2, -2],
        [150000, 5.0, 7, 4, 0],
      ],
      weights: [0.5, 0.2, 0.1, 0.1, 0.1],
      types: ['cost', 'benefit', 'benefit', 'benefit', 'benefit'],
    });
    expect(ranks[2]).toBe(1);
    expect(scores[2]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[0]);
  });

  it('handles empty / single', () => {
    expect(topsis({ matrix: [], weights: [], types: [] }).scores).toEqual([]);
    const single = topsis({
      matrix: [[100]],
      weights: [1],
      types: ['cost'],
    });
    expect(single.ranks).toEqual([1]);
  });

  it('throws on dim mismatch', () => {
    expect(() => topsis({
      matrix: [[1, 2]], weights: [1], types: ['benefit', 'benefit'],
    })).toThrow();
  });
});

describe('entropyWeights', () => {
  it('uniform column → low entropy weight', () => {
    const w = entropyWeights(
      [[5, 1], [5, 9], [5, 5]],
      ['benefit', 'benefit'],
    );
    // 첫 컬럼은 변동 없음 → 가중치 거의 0
    expect(w[0]).toBeLessThan(0.05);
    expect(w[1]).toBeGreaterThan(0.9);
    expect(w[0] + w[1]).toBeCloseTo(1, 5);
  });
});

describe('combineBwmEntropy', () => {
  it('multiplies and normalizes', () => {
    const r = combineBwmEntropy([0.5, 0.5], [0.8, 0.2]);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(r[0]).toBeGreaterThan(r[1]);
  });
});
