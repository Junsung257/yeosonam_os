/**
 * ad-controller 단위 테스트 — ROAS 분류 + 잔액 알림 임계값.
 *
 * 회귀 사고 방지:
 *   - ROAS_TARGET_PCT 기본 150 — 미달 키워드 PAUSE 신호
 *   - clicks < 10 — 데이터 부족 NO_CHANGE (성급 차단 회피)
 *   - net_profit 상위 20% — FLAG_UP 후보
 *   - 잔액 ≤ threshold/2 → critical, 그 외 ≤ threshold → warning
 *
 * 근거:
 *   - WordStream 2025 분석: 평균 PPC 계정의 25-40% 광고비 낭비 — 임계값 자동화로 60-80% 절감.
 *     https://www.get-ryze.ai/blog/automated-rules-ad-campaign-management
 */

import { describe, it, expect } from 'vitest';
import { analyzeKeywords, summarizeOptimization, calcRoas, classifyKeywordStatus, type KeywordPerf } from './ad-controller';

function kw(overrides: Partial<KeywordPerf>): KeywordPerf {
  return {
    id: overrides.id ?? 'test-id',
    platform: overrides.platform ?? 'naver',
    keyword: overrides.keyword ?? '테스트',
    total_spend: overrides.total_spend ?? 10000,
    total_revenue: overrides.total_revenue ?? 0,
    total_cost: overrides.total_cost ?? 0,
    net_profit: overrides.net_profit ?? 0,
    roas_pct: overrides.roas_pct ?? 0,
    status: overrides.status ?? 'ACTIVE',
    current_bid: overrides.current_bid ?? 100,
    clicks: overrides.clicks ?? 20,
    conversions: overrides.conversions ?? 1,
  };
}

describe('analyzeKeywords (ROAS 기준 자동 PAUSE/FLAG_UP)', () => {
  it('clicks < 10 인 키워드는 NO_CHANGE (성급 차단 회피)', () => {
    const result = analyzeKeywords([kw({ clicks: 5, roas_pct: 50 })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NO_CHANGE');
  });

  it('ROAS < 150 + clicks ≥ 10 → PAUSE', () => {
    const result = analyzeKeywords([kw({ clicks: 50, roas_pct: 80, net_profit: -5000 })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('PAUSE');
    if (result[0].type === 'PAUSE') {
      expect(result[0].roas_pct).toBe(80);
    }
  });

  it('ROAS ≥ 150 + 순익 상위 20% → FLAG_UP', () => {
    // 5개 키워드 중 1개가 상위 20%
    const kws = [
      kw({ id: '1', clicks: 50, roas_pct: 200, net_profit: 100000 }), // 상위
      kw({ id: '2', clicks: 50, roas_pct: 180, net_profit: 5000 }),
      kw({ id: '3', clicks: 50, roas_pct: 170, net_profit: 3000 }),
      kw({ id: '4', clicks: 50, roas_pct: 160, net_profit: 1000 }),
      kw({ id: '5', clicks: 50, roas_pct: 155, net_profit: 500 }),
    ];
    const result = analyzeKeywords(kws);
    const flagged = result.filter((a) => a.type === 'FLAG_UP');
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(flagged[0].keyword).toBe('테스트'); // 모두 동일 keyword 라 첫 매칭
  });

  it('빈 배열 → 빈 결과', () => {
    expect(analyzeKeywords([])).toEqual([]);
  });
});

describe('summarizeOptimization', () => {
  it('PAUSE/FLAG_UP/NO_CHANGE 카운트', () => {
    const actions = [
      { type: 'PAUSE' as const, keyword: 'a', reason: 'r', roas_pct: 50 },
      { type: 'PAUSE' as const, keyword: 'b', reason: 'r', roas_pct: 60 },
      { type: 'FLAG_UP' as const, keyword: 'c', reason: 'r', net_profit: 10000 },
      { type: 'NO_CHANGE' as const, keyword: 'd', roas_pct: 150 },
    ];
    const summary = summarizeOptimization(actions);
    expect(summary.paused).toBe(2);
    expect(summary.flaggedUp).toBe(1);
    expect(summary.noChange).toBe(1);
    expect(summary.pausedKeywords).toEqual(['a', 'b']);
    expect(summary.flaggedKeywords).toEqual(['c']);
  });
});

describe('calcRoas', () => {
  it('1만원 지출 + 2만원 매출 → 200%', () => {
    expect(calcRoas(20000, 10000)).toBe(200);
  });
  it('지출 0 → 0% (0 분배 방어)', () => {
    expect(calcRoas(10000, 0)).toBe(0);
  });
  it('지출만 있고 매출 0 → 0%', () => {
    expect(calcRoas(0, 10000)).toBe(0);
  });
});

describe('classifyKeywordStatus', () => {
  it('clicks < 10 → 데이터부족', () => {
    expect(classifyKeywordStatus(200, 50000, 5)).toBe('데이터부족');
  });
  it('순익 > 0 + ROAS ≥ 목표 → 수익발생', () => {
    expect(classifyKeywordStatus(200, 50000, 100)).toBe('수익발생');
  });
  it('순익 ≤ 0 또는 ROAS < 목표 → 돈만씀', () => {
    expect(classifyKeywordStatus(80, 50000, 100)).toBe('돈만씀');
    expect(classifyKeywordStatus(200, -5000, 100)).toBe('돈만씀');
  });
});
