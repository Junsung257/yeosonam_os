/**
 * 예약 워크플로 자동화 정책 — 환경변수로 단계 전환 (코드 분기 최소화).
 *
 * - assisted (기본): 신규 예약은 deposit_notice_blocked=true → 운영자 승인 후 계약금 안내 전이.
 * - full_auto: 신규 예약은 deposit_notice_blocked=false → 랜드/정책만 맞으면 전이·알림 자동화 확장 용이.
 *
 * 향후 semi_auto / 테넌트별 정책은 DB(control_tower)로 옮길 때 이 모듈이 어댑터 역할만 하면 됨.
 */

export type BookingAutomationTier = 'assisted' | 'full_auto';

export function getBookingAutomationTier(): BookingAutomationTier {
  const raw = (process.env.BOOKING_AUTOMATION_TIER ?? 'assisted').trim().toLowerCase();
  if (raw === 'full_auto' || raw === 'full-auto') return 'full_auto';
  return 'assisted';
}

/** 신규 예약 생성 시 deposit_notice_blocked 초기값 */
export function initialDepositNoticeBlockedForNewBooking(): boolean {
  return getBookingAutomationTier() !== 'full_auto';
}

const DEFAULT_TTL_DAYS = 90;

export function guestPortalTokenTtlDays(): number {
  const n = Number(process.env.BOOKING_GUEST_TOKEN_TTL_DAYS);
  if (Number.isFinite(n) && n >= 1 && n <= 365) return Math.floor(n);
  return DEFAULT_TTL_DAYS;
}
