/**
 * payment-command-resolver 단위 테스트 (순수 함수)
 *
 * 커버:
 *   - diffDays / nameScore / dateScore / operatorScore
 *   - scoreBooking (BK-ID 직매치 / 부분 가중치 정규화)
 *   - decideBranch (A/B/C/D 임계값)
 *
 * I/O 함수(resolvePaymentCommand)는 supabase 의존이라 통합테스트 영역.
 */

import { describe, it, expect } from 'vitest';
import { parseCommandInput } from './payment-command-parser';
import {
  diffDays,
  nameScore,
  dateScore,
  operatorScore,
  scoreBooking,
  decideBranch,
  buildPatternSignature,
  applyLearnedRuleBoost,
} from './payment-command-resolver';

describe('diffDays', () => {
  it('같은 날 → 0', () => {
    expect(diffDays('2026-05-05', '2026-05-05')).toBe(0);
  });
  it('다음 날 → +1', () => {
    expect(diffDays('2026-05-06', '2026-05-05')).toBe(1);
  });
  it('전 날 → -1', () => {
    expect(diffDays('2026-05-04', '2026-05-05')).toBe(-1);
  });
});

describe('nameScore', () => {
  it('완전 일치 → 1.0', () => {
    expect(nameScore('남영선', '남영선')).toBe(1.0);
  });
  it('포함 관계 → 0.85', () => {
    expect(nameScore('남영선', '남영선아빠')).toBe(0.85);
    expect(nameScore('홍길동님', '홍길동')).toBe(0.85);
  });
  it('성만 일치 → 0.4', () => {
    expect(nameScore('남영선', '남궁씨')).toBe(0.4);
  });
  it('완전 불일치 → 0', () => {
    expect(nameScore('남영선', '김민수')).toBe(0);
  });
  it('null/빈문자열 → 0', () => {
    expect(nameScore(null, '남영선')).toBe(0);
    expect(nameScore('남영선', null)).toBe(0);
    expect(nameScore('', '남영선')).toBe(0);
  });
});

describe('dateScore', () => {
  it('정확 → 1.0', () => {
    expect(dateScore('2026-05-05', '2026-05-05')).toBe(1.0);
  });
  it('±1일 → 0.85', () => {
    expect(dateScore('2026-05-05', '2026-05-06')).toBe(0.85);
    expect(dateScore('2026-05-05', '2026-05-04')).toBe(0.85);
  });
  it('±3일 → 0.6', () => {
    expect(dateScore('2026-05-05', '2026-05-08')).toBe(0.6);
  });
  it('±7일 → 0.3', () => {
    expect(dateScore('2026-05-05', '2026-05-12')).toBe(0.3);
  });
  it('+8일 → 0', () => {
    expect(dateScore('2026-05-05', '2026-05-13')).toBe(0);
  });
});

describe('operatorScore', () => {
  it('alias 정확 → 1.0', () => {
    expect(operatorScore('베스트아시아', ['베스트아시아', 'BEST'])).toBe(1.0);
  });
  it('alias 부분 매치 → 0.7', () => {
    expect(operatorScore('베스트', ['베스트아시아'])).toBe(0.7);
    expect(operatorScore('(주)베스트투어', ['베스트투어'])).toBe(0.7);
  });
  it('완전 불일치 → 0', () => {
    expect(operatorScore('투어비', ['하나투어'])).toBe(0);
  });
  it('빈 입력 → 0', () => {
    expect(operatorScore(null, ['베스트'])).toBe(0);
    expect(operatorScore('베스트', [])).toBe(0);
  });
});

describe('scoreBooking — BK-ID 직매치', () => {
  it('BK-ID 일치 → 1.0', () => {
    const parsed = parseCommandInput('BK-0042');
    const r = scoreBooking(parsed, { booking_no: 'BK-0042' });
    expect(r.score).toBe(1.0);
  });

  it('BK-ID 불일치 → 다른 신호로 폴백', () => {
    const parsed = parseCommandInput('BK-0042');
    const r = scoreBooking(parsed, { booking_no: 'BK-0099' });
    expect(r.score).toBe(0);
  });
});

describe('scoreBooking — 표준 메모 (date+customer+operator)', () => {
  const parsed = parseCommandInput('260505_남영선_베스트아시아');

  it('세 토큰 모두 정확 일치 → 1.0', () => {
    const r = scoreBooking(parsed, {
      customer_name: '남영선',
      departure_date: '2026-05-05',
      land_operator_aliases: ['베스트아시아'],
    });
    expect(r.score).toBeCloseTo(1.0, 2);
    expect(r.reasons.length).toBe(3);
  });

  it('이름 부분 + 날짜 정확 + 랜드사 정확 → 0.925', () => {
    const r = scoreBooking(parsed, {
      customer_name: '남영선아빠',
      departure_date: '2026-05-05',
      land_operator_aliases: ['베스트아시아'],
    });
    // 0.5 * 0.85 + 0.3 * 1.0 + 0.2 * 1.0 = 0.925
    expect(r.score).toBeCloseTo(0.925, 2);
  });

  it('이름 정확 + 날짜 ±3 + 랜드사 매치 안 됨 → 0.68', () => {
    const r = scoreBooking(parsed, {
      customer_name: '남영선',
      departure_date: '2026-05-08',
      land_operator_aliases: ['베스트투어'],
    });
    // 베스트아시아 ↔ 베스트투어는 includes 관계 아님 → operatorScore = 0
    // 0.5 * 1.0 + 0.3 * 0.6 + 0.2 * 0 = 0.68
    expect(r.score).toBeCloseTo(0.68, 2);
  });

  it('이름 정확 + 날짜 ±3 + 랜드사 부분(includes) → 0.82', () => {
    const parsedShort = parseCommandInput('260505_남영선_베스트');
    const r = scoreBooking(parsedShort, {
      customer_name: '남영선',
      departure_date: '2026-05-08',
      land_operator_aliases: ['베스트아시아'],
    });
    // '베스트' ⊂ '베스트아시아' → 0.7
    // 0.5 * 1.0 + 0.3 * 0.6 + 0.2 * 0.7 = 0.82
    expect(r.score).toBeCloseTo(0.82, 2);
  });

  it('이름 다름 → 점수 낮음', () => {
    const r = scoreBooking(parsed, {
      customer_name: '김민수',
      departure_date: '2026-05-05',
      land_operator_aliases: ['베스트아시아'],
    });
    // 0.5 * 0 + 0.3 * 1.0 + 0.2 * 1.0 = 0.5
    expect(r.score).toBeCloseTo(0.5, 2);
  });
});

describe('scoreBooking — 부분 입력 가중치 정규화', () => {
  it('이름만 입력 + 정확 일치 → 1.0 (정규화)', () => {
    const parsed = parseCommandInput('남영선');
    const r = scoreBooking(parsed, { customer_name: '남영선' });
    expect(r.score).toBeCloseTo(1.0, 2);
  });

  it('날짜만 입력 + 정확 일치 → 1.0', () => {
    const parsed = parseCommandInput('260505');
    const r = scoreBooking(parsed, { departure_date: '2026-05-05' });
    expect(r.score).toBeCloseTo(1.0, 2);
  });

  it('이름 + 날짜만 (operator 없음) + 둘 다 정확 → 1.0', () => {
    const parsed = parseCommandInput('260505_남영선');
    const r = scoreBooking(parsed, {
      customer_name: '남영선',
      departure_date: '2026-05-05',
    });
    expect(r.score).toBeCloseTo(1.0, 2);
  });

  it('parsed 토큰 없음 → 0', () => {
    const parsed = parseCommandInput('   ');
    const r = scoreBooking(parsed, { customer_name: '남영선' });
    expect(r.score).toBe(0);
  });
});

describe('buildPatternSignature', () => {
  it('세 토큰 → DATE_NAME_OP', () => {
    const p = parseCommandInput('260505_남영선_베스트아시아');
    expect(buildPatternSignature(p)).toBe('DATE_NAME_OP');
  });
  it('BK 직타 → BK', () => {
    expect(buildPatternSignature(parseCommandInput('BK-0042'))).toBe('BK');
  });
  it('빈 입력 → EMPTY', () => {
    expect(buildPatternSignature(parseCommandInput('   '))).toBe('EMPTY');
  });
  it('이름만 → NAME', () => {
    expect(buildPatternSignature(parseCommandInput('남영선'))).toBe('NAME');
  });
});

describe('applyLearnedRuleBoost', () => {
  it('룰 없으면 점수 그대로', () => {
    const r = applyLearnedRuleBoost(0.7, undefined);
    expect(r.score).toBe(0.7);
    expect(r.reason).toBeNull();
  });

  it('3회 학습 → 작은 부스트', () => {
    const r = applyLearnedRuleBoost(0.7, {
      id: 'x',
      pattern_signature: 'DATE_NAME_OP',
      parsed_operator_alias: '베스트아시아',
      resolved_operator_id: 'op-1',
      learn_count: 3,
    });
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.score).toBeLessThanOrEqual(0.8);
    expect(r.reason).toMatch(/학습된 패턴/);
  });

  it('100회 학습 → 부스트 ≤ 0.10 캡', () => {
    const r = applyLearnedRuleBoost(0.7, {
      id: 'x',
      pattern_signature: 'DATE_NAME_OP',
      parsed_operator_alias: '베스트아시아',
      resolved_operator_id: 'op-1',
      learn_count: 100,
    });
    expect(r.score).toBeLessThanOrEqual(0.8);
    expect(r.score).toBeGreaterThan(0.78);
  });

  it('점수 1.0 캡', () => {
    const r = applyLearnedRuleBoost(0.99, {
      id: 'x',
      pattern_signature: 'DATE_NAME_OP',
      parsed_operator_alias: null,
      resolved_operator_id: null,
      learn_count: 50,
    });
    expect(r.score).toBeLessThanOrEqual(1.0);
  });
});

describe('decideBranch', () => {
  const parsedFull = parseCommandInput('260505_남영선_베스트아시아');

  it('A: top score ≥ 0.85, 단일 후보', () => {
    const branch = decideBranch(parsedFull, [{ score: 0.95 }], 1);
    expect(branch).toBe('A');
  });

  it('A: 1등 0.95 + 2등 0.5 (큰 차이) → A 유지', () => {
    const branch = decideBranch(parsedFull, [{ score: 0.95 }, { score: 0.5 }], 1);
    expect(branch).toBe('A');
  });

  it('B: 동률 후보 다수 (1등 0.9 + 2등 0.85) → B', () => {
    const branch = decideBranch(parsedFull, [{ score: 0.9 }, { score: 0.85 }], 5);
    expect(branch).toBe('B');
  });

  it('B: top 0.7 (애매한 점수)', () => {
    const branch = decideBranch(parsedFull, [{ score: 0.7 }], 2);
    expect(branch).toBe('B');
  });

  it('C: bookings 0건 + 고객명 입력 + customers DB 비슷한 이름 0건', () => {
    const branch = decideBranch(parsedFull, [], 0);
    expect(branch).toBe('C');
  });

  it('D: bookings 0건이지만 customers 비슷한 이름 있음', () => {
    const branch = decideBranch(parsedFull, [], 3);
    expect(branch).toBe('D');
  });

  it('D: 점수 낮은 후보만 있음', () => {
    const branch = decideBranch(parsedFull, [{ score: 0.4 }], 2);
    expect(branch).toBe('D');
  });
});
