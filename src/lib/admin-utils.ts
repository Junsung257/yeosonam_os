/**
 * 어드민 공통 유틸리티 함수
 * payments/page.tsx, bookings/page.tsx, ledger/page.tsx 에서 공유
 */

/** 숫자 → 천단위 콤마 (예: 1234567 → "1,234,567") */
export function fmtNum(n: number): string {
  return n.toLocaleString('ko-KR');
}

/** ISO 날짜 → YYYY-MM-DD 10자리 (예: "2024-12-25T..." → "2024-12-25") */
export function fmtDateISO(d?: string | null): string {
  return d ? d.slice(0, 10) : '';
}

/** ISO 날짜 → YYYY-MM-DD HH:mm (예: "2024-12-25T13:30:00" → "2024-12-25 13:30") */
export function fmtDateTime(d?: string | null): string {
  if (!d) return '';
  return d.slice(0, 16).replace('T', ' ');
}

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

/**
 * departure_days 정규화 — 저장 포맷 혼재(JSON string / array / plain string) 방어
 * ERR-KUL-01: A4 포스터에 `["금"]` JSON 배열 문자열이 그대로 노출되는 사고 방지
 * 입력: `["금"]` | `["월","수"]` | `["금","일"]` | "월/수" | "금" | null | string[] | undefined
 * 출력: "금" | "월/수" | "금/일" | "" (항상 슬래시 구분 평문)
 */
export function formatDepartureDays(val: unknown): string {
  if (val == null) return '';
  if (Array.isArray(val)) {
    return val.map(v => String(v).trim()).filter(Boolean).join('/');
  }
  const s = String(val).trim();
  if (!s) return '';
  // JSON 배열 문자열 방어: `["금"]`, `["월","수"]`
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean).join('/');
      }
    } catch {
      // JSON.parse 실패 시 원본 반환
    }
  }
  return s;
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
