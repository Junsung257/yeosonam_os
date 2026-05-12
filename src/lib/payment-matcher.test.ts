/**
 * payment-matcher 단위 테스트
 *
 * 재무 직결 모듈 — 회귀가 일어나면 정산 사고. Vitest 부트스트랩 첫 케이스.
 *
 * 커버:
 *   - getBalance / calcPaymentStatus (잔금·상태)
 *   - isRefundTransaction (환불 메모 정규식)
 *   - isFeeTransaction (수수료 허용치)
 *   - matchPaymentToBookings (이름·금액 신뢰도)
 *   - applyDuplicateNameGuard (동명이인 가드)
 *   - classifyMatch (auto/review/unmatched 임계값)
 */

import { describe, it, expect } from 'vitest';
import {
  AUTO_THRESHOLD,
  REVIEW_THRESHOLD,
  FEE_TOLERANCE,
  type BookingCandidate,
  getBalance,
  calcPaymentStatus,
  isRefundTransaction,
  isFeeTransaction,
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
} from './payment-matcher';

const baseBooking = (overrides: Partial<BookingCandidate> = {}): BookingCandidate => ({
  id: 'b1',
  status: 'confirmed',
  customer_name: '홍길동',
  total_price: 1_000_000,
  paid_amount: 0,
  ...overrides,
});

describe('getBalance', () => {
  it('판매가 - 입금액 = 잔금', () => {
    expect(getBalance(baseBooking({ total_price: 1_000_000, paid_amount: 300_000 }))).toBe(700_000);
  });

  it('완납이면 잔금 0', () => {
    expect(getBalance(baseBooking({ total_price: 1_000_000, paid_amount: 1_000_000 }))).toBe(0);
  });

  it('과입금이어도 음수 반환 안 함', () => {
    expect(getBalance(baseBooking({ total_price: 500_000, paid_amount: 600_000 }))).toBe(0);
  });

  it('필드 누락 시 0', () => {
    expect(getBalance(baseBooking({ total_price: undefined, paid_amount: undefined }))).toBe(0);
  });
});

describe('calcPaymentStatus', () => {
  it('완납', () => {
    expect(calcPaymentStatus({ total_price: 1_000_000, paid_amount: 1_000_000 })).toBe('완납');
  });

  it('일부 입금 → 예약금완료', () => {
    expect(calcPaymentStatus({ total_price: 1_000_000, paid_amount: 200_000 })).toBe('예약금완료');
  });

  it('입금 0 → 미입금', () => {
    expect(calcPaymentStatus({ total_price: 1_000_000, paid_amount: 0 })).toBe('미입금');
  });

  it('출금이 원가 + 허용치 초과 → 초과지급(경고) 우선', () => {
    expect(
      calcPaymentStatus({
        total_price: 1_000_000,
        paid_amount: 1_000_000,
        total_cost: 700_000,
        total_paid_out: 700_000 + FEE_TOLERANCE + 1, // 허용치 초과
      }),
    ).toBe('초과지급(경고)');
  });

  it('출금이 원가 + 허용치 이내 → 완납', () => {
    expect(
      calcPaymentStatus({
        total_price: 1_000_000,
        paid_amount: 1_000_000,
        total_cost: 700_000,
        total_paid_out: 700_000 + FEE_TOLERANCE,
      }),
    ).toBe('완납');
  });
});

describe('isRefundTransaction', () => {
  it('"환불" 포함', () => expect(isRefundTransaction('홍길동 환불')).toBe(true));
  it('"refund" 포함 (대소문자 무관)', () => expect(isRefundTransaction('Refund OK')).toBe(true));
  it('"반환" / "취소"', () => {
    expect(isRefundTransaction('계약 취소')).toBe(true);
    expect(isRefundTransaction('이체 반환')).toBe(true);
  });
  it('일반 입금 메모는 false', () => expect(isRefundTransaction('홍길동 입금')).toBe(false));
  it('빈 문자열 안전', () => expect(isRefundTransaction('')).toBe(false));
});

describe('isFeeTransaction', () => {
  it('출금 - 원가가 허용치 이내 양수면 수수료', () => {
    expect(isFeeTransaction({ withdrawalAmount: 705_000, expectedCost: 700_000 })).toEqual({
      isFee: true,
      feeAmount: 5_000,
    });
  });

  it('정확히 허용치면 수수료', () => {
    expect(isFeeTransaction({ withdrawalAmount: 700_000 + FEE_TOLERANCE, expectedCost: 700_000 })).toEqual({
      isFee: true,
      feeAmount: FEE_TOLERANCE,
    });
  });

  it('허용치 초과면 수수료 아님 (초과지급)', () => {
    expect(isFeeTransaction({ withdrawalAmount: 700_000 + FEE_TOLERANCE + 1, expectedCost: 700_000 })).toEqual({
      isFee: false,
      feeAmount: 0,
    });
  });

  it('차액 0 또는 음수면 수수료 아님', () => {
    expect(isFeeTransaction({ withdrawalAmount: 700_000, expectedCost: 700_000 }).isFee).toBe(false);
    expect(isFeeTransaction({ withdrawalAmount: 600_000, expectedCost: 700_000 }).isFee).toBe(false);
  });
});

describe('matchPaymentToBookings', () => {
  it('금액 0이면 빈 배열', () => {
    expect(matchPaymentToBookings({ amount: 0, senderName: '홍길동', bookings: [baseBooking()] })).toEqual([]);
  });

  it('잔금 + 이름 완전일치 → 신뢰도 1.0 (auto 처리 가능)', () => {
    const booking = baseBooking({ total_price: 1_000_000, paid_amount: 0, customer_name: '홍길동' });
    const [match] = matchPaymentToBookings({
      amount: 1_000_000,
      senderName: '홍길동',
      bookings: [booking],
    });
    expect(match.confidence).toBe(1.0);
    expect(match.matchType).toBe('exact');
    expect(classifyMatch(match.confidence)).toBe('auto');
  });

  it('이름은 일치하지만 금액이 크게 다르면 후보 제외', () => {
    const booking = baseBooking({ total_price: 1_000_000, paid_amount: 0 });
    expect(
      matchPaymentToBookings({ amount: 50_000, senderName: '홍길동', bookings: [booking] }),
    ).toEqual([]);
  });

  it('금액 근사 일치 + 이름 부분 일치 → review 임계 근처', () => {
    const booking = baseBooking({ total_price: 1_000_000, paid_amount: 0, customer_name: '홍길동' });
    const [match] = matchPaymentToBookings({
      amount: 1_000_000 - FEE_TOLERANCE, // 근사
      senderName: '홍길동님', // 포함관계 (0.85)
      bookings: [booking],
    });
    expect(match.confidence).toBeCloseTo(0.35 + 0.35, 5); // 0.70
    expect(classifyMatch(match.confidence)).toBe('review');
  });

  it('Rule 4: actual_payer_name(대리입금)으로도 매칭', () => {
    const booking = baseBooking({
      total_price: 500_000,
      paid_amount: 0,
      customer_name: '홍길동',
      actual_payer_name: '김부모',
    });
    const [match] = matchPaymentToBookings({
      amount: 500_000,
      senderName: '김부모',
      bookings: [booking],
    });
    expect(match).toBeDefined();
    expect(match.confidence).toBe(1.0);
  });

  it('Rule 4: passenger_names(동행자)으로도 매칭', () => {
    const booking = baseBooking({
      total_price: 500_000,
      paid_amount: 0,
      customer_name: '홍길동',
      passenger_names: ['이순신', '강감찬'],
    });
    const [match] = matchPaymentToBookings({
      amount: 500_000,
      senderName: '이순신',
      bookings: [booking],
    });
    expect(match).toBeDefined();
    expect(match.confidence).toBe(1.0);
  });

  it('이름 불일치라도 금액 일치하면 amount_only 매칭 후보로 남음', () => {
    const booking = baseBooking({
      total_price: 500_000,
      paid_amount: 0,
      customer_name: '홍길동',
    });
    const [match] = matchPaymentToBookings({
      amount: 500_000,
      senderName: '박전혀다른',
      bookings: [booking],
    });
    expect(match).toBeDefined();
    expect(match.matchType).toBe('amount_only');
    expect(match.confidence).toBe(0.5); // 금액만 일치
    expect(classifyMatch(match.confidence)).toBe('unmatched');
  });

  it('여러 후보 중 신뢰도 내림차순 정렬', () => {
    const bookings = [
      baseBooking({ id: 'low',  customer_name: '박길동',  total_price: 500_000, paid_amount: 0 }),
      baseBooking({ id: 'high', customer_name: '홍길동',  total_price: 500_000, paid_amount: 0 }),
    ];
    const results = matchPaymentToBookings({ amount: 500_000, senderName: '홍길동', bookings });
    expect(results[0].booking.id).toBe('high');
    expect(results[0].confidence).toBeGreaterThan(results[1].confidence);
  });
});

describe('applyDuplicateNameGuard', () => {
  it('동일 이름이 2건 이상이면 신뢰도 페널티', () => {
    const dup = (id: string) => ({
      booking: { ...baseBooking({ id, customer_name: '홍길동', total_price: 500_000, paid_amount: 0 }) },
      confidence: 1.0,
      reasons: ['금액 완전 일치', '이름 완전 일치 (홍길동)'],
      matchType: 'exact' as const,
    });
    const guarded = applyDuplicateNameGuard([dup('a'), dup('b')]);
    expect(guarded[0].confidence).toBeLessThan(1.0);
    expect(guarded[1].confidence).toBeLessThan(1.0);
  });

  it('단일 매칭은 페널티 없음', () => {
    const single = [{
      booking: baseBooking({ customer_name: '홍길동' }),
      confidence: 1.0,
      reasons: [],
      matchType: 'exact' as const,
    }];
    const guarded = applyDuplicateNameGuard(single);
    expect(guarded[0].confidence).toBe(1.0);
  });
});

describe('classifyMatch (임계값 회귀 가드)', () => {
  it(`>= AUTO_THRESHOLD(${AUTO_THRESHOLD}) → 'auto'`, () => {
    expect(classifyMatch(AUTO_THRESHOLD)).toBe('auto');
    expect(classifyMatch(0.95)).toBe('auto');
  });

  it(`>= REVIEW_THRESHOLD(${REVIEW_THRESHOLD}) AND < AUTO → 'review'`, () => {
    expect(classifyMatch(REVIEW_THRESHOLD)).toBe('review');
    expect(classifyMatch(0.75)).toBe('review');
    expect(classifyMatch(AUTO_THRESHOLD - 0.001)).toBe('review');
  });

  it(`< REVIEW_THRESHOLD → 'unmatched'`, () => {
    expect(classifyMatch(REVIEW_THRESHOLD - 0.001)).toBe('unmatched');
    expect(classifyMatch(0)).toBe('unmatched');
  });
});
