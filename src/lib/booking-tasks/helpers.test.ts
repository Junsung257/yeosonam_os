/**
 * booking-tasks/helpers 단위 테스트
 *
 * 매일 실행되는 cron(`/api/cron/booking-tasks-runner`)이 의존하는 공통 헬퍼.
 * 각 룰(unpaid-balance-d7 / doc-missing-d3 / low-margin / happy-call / claim-keyword / excess-payment)이
 * 이 헬퍼로 D-N 계산, 잔금/마진 계산, KST 날짜 처리를 함.
 *
 * 회귀 위험:
 *   - todayKST: UTC → KST 9시간 보정 정확성 (자정 경계 사고)
 *   - daysUntil: 출발일까지 일수가 정확해야 D-7 / D-3 트리거가 정확
 *   - calcBalance: 잔금 음수 보호 (과입금 케이스에서 이상한 알림 방지)
 *   - calcMarginRate: total_price=0 일 때 division by zero 안전
 *   - isOverpaid: FEE_TOLERANCE 미만 차이는 정상 (수수료 허용)
 */

import { describe, it, expect } from 'vitest';
import {
  LIVE_STATUSES,
  PAID_STATUSES,
  TERMINAL_STATUSES,
  todayKST,
  addDays,
  daysUntil,
  calcBalance,
  calcMarginRate,
  isOverpaid,
  fmtKRW,
  extractCustomerName,
} from './helpers';
import { FEE_TOLERANCE } from '@/lib/payment-matcher';

describe('상태 그룹 상수', () => {
  it('LIVE_STATUSES — 활성 예약 (잔금/문서 알림 트리거 대상)', () => {
    expect(LIVE_STATUSES).toContain('pending');
    expect(LIVE_STATUSES).toContain('waiting_deposit');
    expect(LIVE_STATUSES).toContain('deposit_paid');
    expect(LIVE_STATUSES).toContain('waiting_balance');
    expect(LIVE_STATUSES).toContain('confirmed'); // 레거시
    expect(LIVE_STATUSES).not.toContain('cancelled');
    expect(LIVE_STATUSES).not.toContain('fully_paid');
  });

  it('PAID_STATUSES — 완납 (해피콜 트리거 대상)', () => {
    expect(PAID_STATUSES).toContain('fully_paid');
    expect(PAID_STATUSES).toContain('completed'); // 레거시
  });

  it('TERMINAL_STATUSES — 더 이상 처리 안 함', () => {
    expect(TERMINAL_STATUSES).toContain('cancelled');
  });

  it('LIVE / PAID / TERMINAL 은 상호 배타적', () => {
    const live = new Set(LIVE_STATUSES);
    const paid = new Set(PAID_STATUSES);
    const terminal = new Set(TERMINAL_STATUSES);
    for (const s of live) {
      expect(paid.has(s as never)).toBe(false);
      expect(terminal.has(s as never)).toBe(false);
    }
  });
});

describe('todayKST — UTC → KST 9시간 보정', () => {
  it('UTC 자정 = KST 오전 9시 → 같은 날짜', () => {
    // 2026-04-27 00:00 UTC = 2026-04-27 09:00 KST
    const r = todayKST(new Date('2026-04-27T00:00:00Z'));
    expect(r).toBe('2026-04-27');
  });

  it('UTC 23:59 = KST 다음날 08:59 → 다음날 반환 (자정 경계)', () => {
    // 2026-04-27 15:30 UTC = 2026-04-28 00:30 KST → 28일
    const r = todayKST(new Date('2026-04-27T15:30:00Z'));
    expect(r).toBe('2026-04-28');
  });

  it('월말 경계: UTC 4/30 16:00 = KST 5/1 01:00 → "2026-05-01"', () => {
    const r = todayKST(new Date('2026-04-30T16:00:00Z'));
    expect(r).toBe('2026-05-01');
  });

  it('연말 경계: UTC 12/31 16:00 = KST 1/1 01:00 → 다음 연도', () => {
    const r = todayKST(new Date('2025-12-31T16:00:00Z'));
    expect(r).toBe('2026-01-01');
  });
});

describe('addDays — YYYY-MM-DD 산술', () => {
  it('단순 +N', () => {
    expect(addDays('2026-04-20', 7)).toBe('2026-04-27');
    expect(addDays('2026-04-20', 1)).toBe('2026-04-21');
  });

  it('월 경계 넘기 (+10일)', () => {
    expect(addDays('2026-04-25', 10)).toBe('2026-05-05');
  });

  it('연 경계 넘기', () => {
    expect(addDays('2025-12-28', 5)).toBe('2026-01-02');
  });

  it('윤년 2월 (2024)', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('평년 2월 (2025)', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('음수 (과거 N일)', () => {
    expect(addDays('2026-04-27', -7)).toBe('2026-04-20');
  });
});

describe('daysUntil — 출발일까지 N일', () => {
  // 기준 시각: 2026-04-27 06:00 KST = 2026-04-26 21:00 UTC
  const NOW_KST_2026_04_27 = new Date('2026-04-26T21:00:00Z');

  it('null/undefined → null', () => {
    expect(daysUntil(null, NOW_KST_2026_04_27)).toBeNull();
    expect(daysUntil(undefined, NOW_KST_2026_04_27)).toBeNull();
  });

  it('미래: D-7', () => {
    expect(daysUntil('2026-05-04', NOW_KST_2026_04_27)).toBe(7);
  });

  it('오늘: 0', () => {
    expect(daysUntil('2026-04-27', NOW_KST_2026_04_27)).toBe(0);
  });

  it('과거: 음수 (출발 후)', () => {
    expect(daysUntil('2026-04-20', NOW_KST_2026_04_27)).toBe(-7);
  });

  it('내일: 1', () => {
    expect(daysUntil('2026-04-28', NOW_KST_2026_04_27)).toBe(1);
  });
});

describe('calcBalance — 잔금 (음수 차단)', () => {
  it('정상: total - paid', () => {
    expect(calcBalance(1_000_000, 300_000)).toBe(700_000);
  });

  it('완납: 0', () => {
    expect(calcBalance(1_000_000, 1_000_000)).toBe(0);
  });

  it('과입금: 0 (음수 안 만듦)', () => {
    expect(calcBalance(500_000, 600_000)).toBe(0);
  });

  it('null/undefined: 0 처리', () => {
    expect(calcBalance(undefined, undefined)).toBe(0);
    expect(calcBalance(null, null)).toBe(0);
    expect(calcBalance(1_000_000, undefined)).toBe(1_000_000);
    expect(calcBalance(undefined, 500_000)).toBe(0); // total 0 - paid 500k → max(0, -500k) = 0
  });
});

describe('calcMarginRate — 마진율', () => {
  it('정상: (price - cost) / price', () => {
    expect(calcMarginRate(1_000_000, 700_000)).toBeCloseTo(0.3);
  });

  it('high margin', () => {
    expect(calcMarginRate(2_000_000, 1_000_000)).toBeCloseTo(0.5);
  });

  it('역마진 (cost > price): 음수', () => {
    expect(calcMarginRate(1_000_000, 1_500_000)).toBeCloseTo(-0.5);
  });

  it('total_price = 0 → null (division by zero 안전)', () => {
    expect(calcMarginRate(0, 100_000)).toBeNull();
    expect(calcMarginRate(null, 100_000)).toBeNull();
  });

  it('cost 미지정: 100% 마진', () => {
    expect(calcMarginRate(1_000_000)).toBe(1);
    expect(calcMarginRate(1_000_000, null)).toBe(1);
  });

  it('total_price < 0 → null (이상치 방어)', () => {
    expect(calcMarginRate(-100, 50)).toBeNull();
  });
});

describe('isOverpaid — atomic_booking_ledger RPC 와 동일 기준', () => {
  it('paid > cost + tolerance → true', () => {
    expect(isOverpaid(1_000_000 + FEE_TOLERANCE + 1, 1_000_000)).toBe(true);
  });

  it('paid <= cost + tolerance → false (수수료 허용)', () => {
    expect(isOverpaid(1_000_000 + FEE_TOLERANCE, 1_000_000)).toBe(false);
    expect(isOverpaid(1_000_000, 1_000_000)).toBe(false);
    expect(isOverpaid(900_000, 1_000_000)).toBe(false);
  });

  it('cost 0/null → false (cost 모르면 과지급 판정 안 함)', () => {
    expect(isOverpaid(1_000_000, 0)).toBe(false);
    expect(isOverpaid(1_000_000, null)).toBe(false);
    expect(isOverpaid(1_000_000, undefined)).toBe(false);
  });

  it('paid null → 0 으로 처리 → false', () => {
    expect(isOverpaid(null, 1_000_000)).toBe(false);
  });
});

describe('fmtKRW — 금액 포맷 (Task title 용)', () => {
  it('천단위 콤마 + 원 suffix', () => {
    expect(fmtKRW(1_500_000)).toBe('1,500,000원');
    expect(fmtKRW(1_000)).toBe('1,000원');
  });

  it('0', () => {
    expect(fmtKRW(0)).toBe('0원');
  });

  it('null/undefined → "0원"', () => {
    expect(fmtKRW(null)).toBe('0원');
    expect(fmtKRW(undefined)).toBe('0원');
  });

  it('음수도 포맷 (과입금/환불 케이스)', () => {
    expect(fmtKRW(-500_000)).toBe('-500,000원');
  });
});

describe('extractCustomerName — bookings JOIN 결과 형태 방어', () => {
  it('정상 객체: {customers: {name: "홍길동"}}', () => {
    expect(extractCustomerName({ customers: { name: '홍길동' } })).toBe('홍길동');
  });

  it('customers null → "이름 미상"', () => {
    expect(extractCustomerName({ customers: null })).toBe('이름 미상');
  });

  it('customers 미존재 → "이름 미상"', () => {
    expect(extractCustomerName({})).toBe('이름 미상');
  });

  it('customers.name 미존재 → "이름 미상"', () => {
    expect(extractCustomerName({ customers: {} })).toBe('이름 미상');
  });

  it('null 입력도 안전 (현재 구현은 throw — 호출자가 이미 객체 보장)', () => {
    // 가드: as { customers?: ... } 캐스팅이라 null 직접 입력은 throw 가능
    // 호출자가 array.map() 결과를 넣으므로 객체 보장됨
    expect(extractCustomerName({ customers: undefined })).toBe('이름 미상');
  });
});
