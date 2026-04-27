/**
 * admin-utils 단위 테스트
 *
 * 어드민 페이지(payments / bookings / ledger) 공유 포매터.
 * 회귀 위험:
 *   - ERR-KUL-01 (formatDepartureDays): JSON 배열 문자열 `["금"]` 이 그대로 노출되는 사고
 *   - 금액 fmtK / fmt만 의 경계값 (0, 9999, 10000, 1억-1, 1억)
 */

import { describe, it, expect } from 'vitest';
import {
  fmt만,
  fmtK,
  fmtDate,
  formatDepartureDays,
  getBalance,
  nameSim,
} from './admin-utils';

describe('fmt만 — 정확한 1자리 소수', () => {
  it('1,230,000 → "123.0만"', () => {
    expect(fmt만(1_230_000)).toBe('123.0만');
  });

  it('500,000 → "50.0만"', () => {
    expect(fmt만(500_000)).toBe('50.0만');
  });

  it('0 → "0.0만"', () => {
    expect(fmt만(0)).toBe('0.0만');
  });

  it('음수도 처리', () => {
    expect(fmt만(-100_000)).toBe('-10.0만');
  });
});

describe('fmtK — 단위 자동 (만/억/원)', () => {
  it('< 10,000 → 천단위 콤마', () => {
    expect(fmtK(0)).toBe('0');
    expect(fmtK(9_999)).toBe('9,999');
  });

  it('10,000 ~ 99,999,999 → "N만" (정수 round)', () => {
    expect(fmtK(10_000)).toBe('1만');
    expect(fmtK(1_500_000)).toBe('150만');
  });

  it('1억 이상 → "N.N억"', () => {
    expect(fmtK(100_000_000)).toBe('1.0억');
    expect(fmtK(1_500_000_000)).toBe('15.0억');
  });

  it('경계: 99,999,999 → "만" / 100,000,000 → "억"', () => {
    expect(fmtK(99_999_999)).toContain('만');
    expect(fmtK(100_000_000)).toContain('억');
  });

  it('음수도 동일 단위 분기 (절댓값 기준)', () => {
    expect(fmtK(-1_000_000)).toBe('-100만');
  });
});

describe('fmtDate', () => {
  it('ISO 문자열 → YY-MM-DD', () => {
    expect(fmtDate('2026-04-27T10:30:00Z')).toBe('26-04-27');
  });

  it('빈/undefined → ""', () => {
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });
});

describe('formatDepartureDays — ERR-KUL-01 방어', () => {
  it('null/undefined → ""', () => {
    expect(formatDepartureDays(null)).toBe('');
    expect(formatDepartureDays(undefined)).toBe('');
  });

  it('순수 string → 그대로', () => {
    expect(formatDepartureDays('월/수')).toBe('월/수');
    expect(formatDepartureDays('금')).toBe('금');
  });

  it('실제 배열 → 슬래시 결합', () => {
    expect(formatDepartureDays(['월', '수'])).toBe('월/수');
    expect(formatDepartureDays(['금'])).toBe('금');
  });

  it('JSON 배열 문자열 `["금"]` → 평문 "금" (ERR-KUL-01)', () => {
    expect(formatDepartureDays('["금"]')).toBe('금');
    expect(formatDepartureDays('["월","수"]')).toBe('월/수');
  });

  it('JSON 파싱 실패해도 원본 반환 (방어)', () => {
    expect(formatDepartureDays('[잘못된JSON]')).toBe('[잘못된JSON]');
  });

  it('빈 문자열 → ""', () => {
    expect(formatDepartureDays('  ')).toBe('');
  });

  it('빈 항목 필터링', () => {
    expect(formatDepartureDays(['월', '', '수'])).toBe('월/수');
    expect(formatDepartureDays('["월","","수"]')).toBe('월/수');
  });
});

describe('getBalance', () => {
  it('판매가 - 입금액 = 잔금', () => {
    expect(getBalance({ total_price: 1_000_000, paid_amount: 300_000 })).toBe(700_000);
  });

  it('완납이면 0', () => {
    expect(getBalance({ total_price: 1_000_000, paid_amount: 1_000_000 })).toBe(0);
  });

  it('과입금 → 0 (음수 반환 안 함)', () => {
    expect(getBalance({ total_price: 500_000, paid_amount: 600_000 })).toBe(0);
  });

  it('필드 누락 → 0', () => {
    expect(getBalance({})).toBe(0);
  });
});

describe('nameSim — 이름 유사도', () => {
  it('완전 일치 = 1.0', () => {
    expect(nameSim('홍길동', '홍길동')).toBe(1.0);
  });

  it('공백 차이 무시', () => {
    expect(nameSim('홍 길동', '홍길동')).toBe(1.0);
    expect(nameSim('홍길동', '홍 길 동')).toBe(1.0);
  });

  it('포함 관계 = 0.7', () => {
    expect(nameSim('홍길동', '홍길동외 1인')).toBe(0.7);
    expect(nameSim('홍길동외 1인', '홍길동')).toBe(0.7);
  });

  it('첫 글자만 일치 = 0.3', () => {
    expect(nameSim('홍길동', '홍철수')).toBe(0.3);
  });

  it('완전 무관 = 0', () => {
    expect(nameSim('홍길동', '김영희')).toBe(0);
  });

  it('빈 입력 = 0', () => {
    expect(nameSim('', '홍길동')).toBe(0);
    expect(nameSim('홍길동', '')).toBe(0);
    expect(nameSim()).toBe(0);
  });
});
