/**
 * 여소남 OS — Booking Tasks 공통 헬퍼
 *
 * 각 룰에서 공통으로 쓰는 예약 상태 판정 / 날짜 계산 유틸.
 * payment-matcher.ts 의 상수와 일관성 유지.
 */

import { FEE_TOLERANCE } from '@/lib/payment-matcher';

export const LIVE_STATUSES = [
  'pending',
  'waiting_deposit',
  'deposit_paid',
  'waiting_balance',
  'confirmed',          // 레거시
] as const;

export const PAID_STATUSES = ['fully_paid', 'completed'] as const;
export const TERMINAL_STATUSES = ['cancelled'] as const;

/** KST 기준 오늘 (YYYY-MM-DD) — 서버 UTC와 무관하게 한국 로컬 날짜 */
export function todayKST(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** YYYY-MM-DD 문자열에 N일 더하기 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 출발일까지 며칠 남았는지 (음수 = 출발 후) */
export function daysUntil(dateStr: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const today = new Date(todayKST(now) + 'T00:00:00Z').getTime();
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.round((d - today) / (24 * 60 * 60 * 1000));
}

/** 잔금 (음수면 0 처리) */
export function calcBalance(totalPrice?: number | null, paidAmount?: number | null): number {
  return Math.max(0, (totalPrice ?? 0) - (paidAmount ?? 0));
}

/** 마진율 (total_price - total_cost) / total_price. total_price=0 이면 null */
export function calcMarginRate(
  totalPrice?: number | null,
  totalCost?: number | null,
): number | null {
  if (!totalPrice || totalPrice <= 0) return null;
  const cost = totalCost ?? 0;
  return (totalPrice - cost) / totalPrice;
}

/** 초과지급 여부 — atomic_booking_ledger RPC 와 동일 기준 */
export function isOverpaid(totalPaidOut?: number | null, totalCost?: number | null): boolean {
  if (!totalCost || totalCost <= 0) return false;
  return (totalPaidOut ?? 0) > totalCost + FEE_TOLERANCE;
}

/** 금액 포맷 (Task title 에 인간 친화적으로) */
export function fmtKRW(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0원';
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 고객명 추출 (bookings join 결과 형태 제각각 방어) */
export function extractCustomerName(b: unknown): string {
  const record = b as { customers?: { name?: string } | null };
  return record.customers?.name ?? '이름 미상';
}

/** 표준 min SELECT — 모든 룰에서 공통으로 필요한 예약 필드 */
export const BOOKING_SELECT_MIN = `
  id, booking_no, package_title, departure_date,
  status, payment_status, is_deleted,
  total_price, total_cost, paid_amount, total_paid_out,
  has_sent_docs,
  customers!lead_customer_id (name, phone)
`;
