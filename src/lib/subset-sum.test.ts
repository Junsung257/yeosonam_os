import { describe, it, expect } from 'vitest';
import { findSubsetSum } from './subset-sum';

describe('findSubsetSum', () => {
  it('정확 일치 단일 항목', () => {
    const r = findSubsetSum(
      [
        { id: 'a', amount: 100_000 },
        { id: 'b', amount: 200_000 },
        { id: 'c', amount: 300_000 },
      ],
      200_000,
    );
    expect(r?.items.map(x => x.id)).toEqual(['b']);
    expect(r?.diff).toBe(0);
  });

  it('정확 일치 다중 항목 (200 = 50+150)', () => {
    const r = findSubsetSum(
      [
        { id: 'a', amount: 50_000 },
        { id: 'b', amount: 150_000 },
        { id: 'c', amount: 80_000 },
      ],
      200_000,
    );
    expect(r).not.toBeNull();
    expect(r!.total).toBe(200_000);
    expect(r!.items.length).toBe(2);
  });

  it('수수료 허용 오차 내 근사 매치', () => {
    const r = findSubsetSum(
      [
        { id: 'a', amount: 100_000 },
        { id: 'b', amount: 99_000 },
      ],
      100_000,
      { tolerance: 5_000 },
    );
    // 100,000 정확 매치가 우선
    expect(r?.items[0].id).toBe('a');
  });

  it('어떤 조합도 안 맞으면 null', () => {
    const r = findSubsetSum(
      [
        { id: 'a', amount: 100_000 },
        { id: 'b', amount: 200_000 },
      ],
      50_000,
      { tolerance: 1_000 },
    );
    expect(r).toBeNull();
  });

  it('빈 입력 또는 target 0 → null', () => {
    expect(findSubsetSum([], 100)).toBeNull();
    expect(findSubsetSum([{ id: 'a', amount: 100 }], 0)).toBeNull();
  });

  it('큰 입력 (20개) — deadline 안 + 정답 찾음', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      amount: 100_000 + i * 10_000,
    }));
    const target = items[3].amount + items[7].amount + items[15].amount; // 정답 존재
    const r = findSubsetSum(items, target, { deadlineMs: 500 });
    expect(r).not.toBeNull();
    expect(Math.abs(r!.diff)).toBeLessThanOrEqual(5_000);
  });

  it('best-effort: 정확 매치 없으면 가장 근접한 것 반환', () => {
    const r = findSubsetSum(
      [
        { id: 'a', amount: 50_000 },
        { id: 'b', amount: 50_000 },
      ],
      99_000,
      { tolerance: 5_000 },
    );
    expect(r).not.toBeNull();
    expect(r!.total).toBe(100_000);
    expect(r!.diff).toBe(1_000);
  });
});
