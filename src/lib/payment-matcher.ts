/**
 * 여소남 OS — 입출금 ↔ 예약 매칭 알고리즘 (8대 핵심 로직)
 *
 * 용어 정의:
 *   판매가(total_price)  : 고객에게 받는 총요금
 *   원가(total_cost)     : 랜드사(현지 여행사)에 지급하는 금액
 *   미수금               : 판매가 - 총입금액
 *   초과지급             : 총출금액 - 원가 > 0 (수수료 허용치 초과)
 *
 * 신뢰도 기준:
 *   ≥ 0.90 → auto   (자동 정산)
 *   ≥ 0.60 → review (관리자 확인)
 *   < 0.60 → unmatched (미확인 돈통 — Rule 5)
 */

export const FEE_TOLERANCE    = 5_000; // Rule 8: 수수료 허용 오차 (원)
export const AUTO_THRESHOLD   = 0.90;  // 자동 처리 신뢰도 임계값
export const REVIEW_THRESHOLD = 0.60;  // 검토 필요 신뢰도 임계값

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

export interface BookingCandidate {
  id: string;
  booking_no?: string;
  package_title?: string;
  total_price?: number;
  total_cost?: number;
  paid_amount?: number;
  total_paid_out?: number;
  status: string;
  payment_status?: string;
  customer_name?: string;           // 예약자명 (lead_customer)
  actual_payer_name?: string | null; // Rule 4: 실제 입금자명 (대리입금)
  passenger_names?: string[];
}

export interface MatchResult {
  booking: BookingCandidate;
  confidence: number;    // 0.0 ~ 1.0
  reasons: string[];
  matchType: 'exact' | 'fuzzy' | 'amount_only';
}

// ─── 핵심 유틸리티 ────────────────────────────────────────────────────────────

/**
 * 이름 유사도 계산 (0~1)
 * 1.00 : 완전 일치
 * 0.85 : 포함 관계 (예: '홍길동' ↔ '홍길동님')
 * 0.60 : 성(첫 글자) 일치
 * 0.00 : 불일치
 */
function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const s = a.trim();
  const c = b.trim();
  if (!s || !c) return 0;

  if (s === c) return 1.0;
  if (c.includes(s) || s.includes(c)) return 0.85;
  if (s[0] === c[0]) return 0.60;
  return 0;
}

/** Rule 1: 예약 잔금 계산 (판매가 - 총입금액) */
export function getBalance(booking: BookingCandidate): number {
  return Math.max(0, (booking.total_price || 0) - (booking.paid_amount || 0));
}

/**
 * Rule 1 & 2: 결제 상태 계산
 * - 완납         : 총입금액 >= 판매가
 * - 예약금완료   : 일부 입금
 * - 미입금       : 입금 없음
 * - 초과지급(경고): 총출금액 > 원가 + 수수료허용치
 */
export function calcPaymentStatus(booking: {
  total_price?: number;
  total_cost?: number;
  paid_amount?: number;
  total_paid_out?: number;
}): string {
  const totalPrice   = booking.total_price   || 0;
  const totalCost    = booking.total_cost    || 0;
  const paidAmount   = booking.paid_amount   || 0;
  const totalPaidOut = booking.total_paid_out || 0;

  // Rule 2: 초과지급 우선 감지
  if (totalCost > 0 && totalPaidOut > totalCost + FEE_TOLERANCE) {
    return '초과지급(경고)';
  }
  // Rule 1: 완납 여부
  if (totalPrice > 0 && paidAmount >= totalPrice) return '완납';
  if (paidAmount > 0) return '예약금완료';
  return '미입금';
}

/**
 * Rule 6: 출금의 환불 여부 판단
 * 메모(적요)에 '환불', 'refund', '반환', '취소' 포함 시 환불 처리
 */
export function isRefundTransaction(memo: string): boolean {
  return /환불|refund|반환|취소/i.test(memo ?? '');
}

/**
 * Rule 8: 수수료 출금 여부 판단
 * 출금액이 원가보다 FEE_TOLERANCE 이내로 크면 → 수수료로 분리
 */
export function isFeeTransaction(params: {
  withdrawalAmount: number;
  expectedCost: number;
}): { isFee: boolean; feeAmount: number } {
  const diff = params.withdrawalAmount - params.expectedCost;
  if (diff > 0 && diff <= FEE_TOLERANCE) {
    return { isFee: true, feeAmount: diff };
  }
  return { isFee: false, feeAmount: 0 };
}

// ─── 핵심 매칭 로직 ───────────────────────────────────────────────────────────

/**
 * 입금 트랜잭션을 예약 후보들과 매칭 (Rule 3, 4, 5)
 * @returns 신뢰도 내림차순 정렬된 매칭 결과 배열
 */
export function matchPaymentToBookings(params: {
  amount: number;
  senderName: string | null;
  bookings: BookingCandidate[];
}): MatchResult[] {
  const { amount, senderName, bookings } = params;

  if (!amount || amount <= 0) return [];

  const results: MatchResult[] = [];

  for (const booking of bookings) {
    const reasons: string[] = [];
    let confidence = 0;
    let matchType: MatchResult['matchType'] = 'amount_only';

    const balance = getBalance(booking);

    // ── 금액 매칭 ──────────────────────────────────────────────────────────
    const exactAmount = balance > 0 && amount === balance;
    const nearAmount  = !exactAmount && balance > 0 && Math.abs(amount - balance) <= FEE_TOLERANCE;

    if (exactAmount) {
      confidence += 0.50;
      reasons.push(`금액 완전 일치 (${amount.toLocaleString()}원)`);
    } else if (nearAmount) {
      confidence += 0.35;
      reasons.push(`금액 근사 일치 (차액 ${Math.abs(amount - balance).toLocaleString()}원)`);
    } else {
      continue; // 금액 차이가 크면 매칭 후보 제외
    }

    // ── 이름 매칭 (Rule 4: 예약자 + 실제입금자 + 동행자 모두 검색) ───────────
    const allNames = [
      booking.customer_name,
      booking.actual_payer_name,
      ...(booking.passenger_names || []),
    ].filter(Boolean) as string[];

    let bestScore = 0;
    let bestName  = '';

    for (const name of allNames) {
      const score = nameSimilarity(senderName, name);
      if (score > bestScore) {
        bestScore = score;
        bestName  = name;
      }
    }

    if (bestScore >= 1.0) {
      confidence += 0.50;
      matchType   = exactAmount ? 'exact' : 'fuzzy';
      reasons.push(`이름 완전 일치 (${bestName})`);
    } else if (bestScore >= 0.85) {
      confidence += 0.35;
      matchType   = 'fuzzy';
      reasons.push(`이름 부분 일치 (${senderName} ≈ ${bestName})`);
    } else if (bestScore >= 0.60) {
      confidence += 0.20;
      reasons.push(`성 일치 (${senderName?.[0]} → ${bestName})`);
    } else {
      reasons.push(`이름 불일치 (입금자: ${senderName})`);
    }

    if (confidence >= 0.35) {
      results.push({
        booking,
        confidence: Math.min(confidence, 1.0),
        reasons,
        matchType,
      });
    }
  }

  // 신뢰도 내림차순 정렬
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Rule 3: 동명이인 방어
 * auto 후보가 2건 이상 → 모두 review로 격하
 */
export function applyDuplicateNameGuard(results: MatchResult[]): MatchResult[] {
  if (results.length <= 1) return results;

  const autoCount = results.filter(r => r.confidence >= AUTO_THRESHOLD).length;
  if (autoCount <= 1) return results;

  // auto 후보가 여러 개 → 동명이인 → 전원 review로 낮춤
  return results.map(r => {
    if (r.confidence >= AUTO_THRESHOLD) {
      return {
        ...r,
        confidence: REVIEW_THRESHOLD, // review 경계값으로 격하
        reasons: [...r.reasons, '⚠️ 동명이인 감지 — 관리자 확인 필요'],
      };
    }
    return r;
  });
}

/** 신뢰도 → 처리 방식 분류 */
export function classifyMatch(confidence: number): 'auto' | 'review' | 'unmatched' {
  if (confidence >= AUTO_THRESHOLD)   return 'auto';
  if (confidence >= REVIEW_THRESHOLD) return 'review';
  return 'unmatched';
}
