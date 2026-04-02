/**
 * 인플루언서/제휴사 시스템 공통 상수
 * 정산 기준, 세율 등을 한 곳에서 관리 — 변경 시 여기만 수정
 */

export const AFFILIATE_CONFIG = {
  /** 정산 최소 금액 (원) — 이월 누적 포함 */
  SETTLEMENT_MIN_AMOUNT: 100_000,
  /** 정산 최소 예약 건수 — 금액과 AND 조건 */
  SETTLEMENT_MIN_BOOKINGS: 3,
  /** 개인(3.3%) 원천징수율 */
  PERSONAL_TAX_RATE: 0.033,

  /** PIN 로그인 보안 */
  PIN_MAX_ATTEMPTS: 5,
  PIN_WINDOW_MINUTES: 5,
  PIN_LOCKOUT_MINUTES: 30,
} as const;
