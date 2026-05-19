/**
 * Thompson Sampling MAB 회귀 fixture.
 *
 * 학술 근거:
 *   - Chapelle & Li 2011 "An Empirical Evaluation of Thompson Sampling" (NeurIPS)
 *   - Google Analytics Optimize 의 표준 알고리즘
 *
 * 검증:
 *   - 단일 arm 입력 → 그 arm 그대로 반환
 *   - 빈 배열 → null
 *   - 같은 success/trial 분포에서 통계적으로 best performer 가 더 자주 선택됨
 *   - pickArmGreedyCTR 의 동률/0-trial 처리
 */

import { describe, it, expect } from 'vitest';
import { pickArmThompson, pickArmGreedyCTR, type CreativeBanditArm } from './ad-creative-bandit';

describe('pickArmThompson', () => {
  it('빈 배열 → null', () => {
    expect(pickArmThompson([])).toBeNull();
  });

  it('단일 arm → 해당 arm.id', () => {
    expect(pickArmThompson([{ id: 'only', successCount: 0, trialCount: 0 }])).toBe('only');
  });

  it('명백한 best performer 가 100회 시뮬레이션 중 60% 이상 선택됨 (통계 검증)', () => {
    // arm A: 99/100 = 99% CTR (clear winner)
    // arm B: 1/100 = 1% CTR
    // arm C: 1/100 = 1% CTR
    const arms: CreativeBanditArm[] = [
      { id: 'A', successCount: 99, trialCount: 100 },
      { id: 'B', successCount: 1, trialCount: 100 },
      { id: 'C', successCount: 1, trialCount: 100 },
    ];
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 200; i++) {
      const picked = pickArmThompson(arms);
      if (picked) counts[picked]++;
    }
    // Thompson 은 명백한 winner 를 점점 더 자주 선택. 200회 중 60%(120회) 이상 A.
    expect(counts.A).toBeGreaterThan(120);
  });

  it('콜드 스타트 (모든 arm trial=0) → 균등 분포에 가까움', () => {
    const arms: CreativeBanditArm[] = [
      { id: 'A', successCount: 0, trialCount: 0 },
      { id: 'B', successCount: 0, trialCount: 0 },
      { id: 'C', successCount: 0, trialCount: 0 },
    ];
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 300; i++) {
      const picked = pickArmThompson(arms);
      if (picked) counts[picked]++;
    }
    // 300회 / 3 arm = 100. 각 arm 50~150 범위 안에 들어야 (균등에 가까움)
    expect(counts.A).toBeGreaterThan(50);
    expect(counts.A).toBeLessThan(150);
    expect(counts.B).toBeGreaterThan(50);
    expect(counts.B).toBeLessThan(150);
    expect(counts.C).toBeGreaterThan(50);
    expect(counts.C).toBeLessThan(150);
  });
});

describe('pickArmGreedyCTR', () => {
  it('빈 배열 → null', () => {
    expect(pickArmGreedyCTR([])).toBeNull();
  });

  it('CTR 최댓값 arm 결정적 선택', () => {
    const arms: CreativeBanditArm[] = [
      { id: 'A', successCount: 10, trialCount: 100 }, // 10%
      { id: 'B', successCount: 30, trialCount: 100 }, // 30%
      { id: 'C', successCount: 20, trialCount: 100 }, // 20%
    ];
    expect(pickArmGreedyCTR(arms)).toBe('B');
  });

  it('trial=0 arm 끼어 있어도 0 으로 처리, 최댓값 arm 선택', () => {
    const arms: CreativeBanditArm[] = [
      { id: 'A', successCount: 5, trialCount: 10 }, // 50%
      { id: 'B', successCount: 0, trialCount: 0 },  // 0% (분배 방어)
    ];
    expect(pickArmGreedyCTR(arms)).toBe('A');
  });
});
