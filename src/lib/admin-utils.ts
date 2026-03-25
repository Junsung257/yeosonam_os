/**
 * 어드민 공통 유틸리티 함수
 * payments/page.tsx, bookings/page.tsx, ledger/page.tsx 에서 공유
 */

/** 원화 정수 → 만원 단위 문자열 (예: 1230000 → "123.0만") */
export function fmt만(n: number): string {
  return `${(n / 10000).toFixed(1)}만`;
}

/** 원화 정수 → 간략 "123만" 표기 (소수점 없음) */
export function fmtK(n: number): string {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000)}만`;
  return n.toLocaleString();
}

/** 날짜 ISO 문자열 → 2자리 연-월-일 (예: "2024-12-25T..." → "24-12-25") */
export function fmtDate(d?: string): string {
  return d ? d.slice(2, 10).replace(/-/g, '-') : '';
}

/** 예약의 잔금 (판매가 - 입금액, 최소 0) */
export function getBalance(booking: {
  total_price?: number;
  paid_amount?: number;
}): number {
  return Math.max(0, (booking.total_price || 0) - (booking.paid_amount || 0));
}

/**
 * 이름 유사도 (0 ~ 1.0)
 * 1.0 = 동일, 0.7 = 포함 관계, 0.3 = 첫 글자 일치, 0 = 무관계
 */
export function nameSim(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const an = a.replace(/\s+/g, '');
  const bn = b.replace(/\s+/g, '');
  if (an === bn) return 1.0;
  if (an.includes(bn) || bn.includes(an)) return 0.7;
  if (an[0] === bn[0]) return 0.3;
  return 0;
}
