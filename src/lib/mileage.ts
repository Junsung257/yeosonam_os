/**
 * 마일리지 적립률 및 계산 유틸리티
 * 등급에 따른 적립률과 마일리지 계산 로직을 중앙화합니다.
 */

// ─── 등급별 마일리지 적립률 ────────────────────────────────────

export const GRADE_CONFIG = {
  VVIP: { rate: 0.05, label: 'VVIP', minSpent: 10_000_000 },
  우수: { rate: 0.03, label: '우수', minSpent:  3_000_000 },
  일반: { rate: 0.01, label: '일반', minSpent:    500_000 },
  신규: { rate: 0.01, label: '신규', minSpent:          0 },
} as const;

export type Grade = keyof typeof GRADE_CONFIG;

/** 결제 금액에 등급 적립률을 곱해 마일리지 반환 */
export function calcMileageEarned(amount: number, grade: string): number {
  const cfg = GRADE_CONFIG[grade as Grade] ?? GRADE_CONFIG['신규'];
  return Math.round(amount * cfg.rate);
}

/** total_spent와 카페 점수로 등급을 계산 (DB 트리거와 동일 로직) */
export function calcGrade(totalSpent: number, cafeScore: number = 0): Grade {
  if (totalSpent >= 10_000_000 || cafeScore >= 50) return 'VVIP';
  if (totalSpent >=  3_000_000 || cafeScore >= 30) return '우수';
  if (totalSpent >=    500_000 || cafeScore >= 10) return '일반';
  return '신규';
}

/** 등급 표시용 스타일 */
export const GRADE_STYLE: Record<string, {
  badge: string;
  rowBg: string;
  border: string;
  text: string;
}> = {
  VVIP: {
    badge:  'bg-purple-100 text-purple-800 border border-purple-300',
    rowBg:  'bg-purple-50',
    border: 'border-l-4 border-purple-400',
    text:   'text-purple-700',
  },
  우수: {
    badge:  'bg-blue-100 text-blue-800 border border-blue-200',
    rowBg:  'bg-blue-50',
    border: 'border-l-4 border-blue-400',
    text:   'text-blue-700',
  },
  일반: {
    badge:  'bg-gray-100 text-gray-700 border border-gray-200',
    rowBg:  '',
    border: '',
    text:   'text-gray-600',
  },
  신규: {
    badge:  'bg-green-100 text-green-700 border border-green-200',
    rowBg:  '',
    border: '',
    text:   'text-green-700',
  },
};

/** 고객 상태 생애주기 */
export const LIFECYCLE_STAGES = [
  '잠재고객',
  '상담중',
  '예약완료',
  '여행중',
  '여행완료',
] as const;

export type CustomerStatus = typeof LIFECYCLE_STAGES[number];

/** 현재 상태에 따른 다음 추천 액션 */
export function getNextAction(
  status: string,
  daysSinceLastBooking?: number,
): { icon: string; label: string; type: 'call' | 'message' | 'notify' | 'check' | 'review' } | null {
  switch (status as CustomerStatus) {
    case '잠재고객':
      return { icon: '📞', label: '첫 상담 연락하기', type: 'call' };
    case '상담중':
      return { icon: '📋', label: '맞춤 견적서 발송하기', type: 'message' };
    case '예약완료':
      return { icon: '✈️', label: '출발 전 준비사항 안내 발송', type: 'notify' };
    case '여행중':
      return { icon: '🌏', label: '현지 케어 안부 연락', type: 'check' };
    case '여행완료':
      if (!daysSinceLastBooking || daysSinceLastBooking >= 3) {
        return { icon: '📝', label: '카페 후기 유도 메시지 발송', type: 'review' };
      }
      return null;
    default:
      return null;
  }
}
