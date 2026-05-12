/**
 * 패키지 가격 / 써차지 / 커미션 계산 — 순수 유틸리티
 *
 * `supabase.ts` (god module 3,325 LOC) 에서 추출. DB 의존 0건.
 * 기존 import 호환을 위해 `supabase.ts` 에서 re-export 됨.
 *
 * 추가 사용처:
 *   - src/lib/jarvis/tools/product-tools.ts
 *   - src/app/api/qa/chat/route.ts (로컬 복제본 존재 — 추후 통합 후보)
 */

export interface PriceTierLike {
  departure_dates?: string[];
  date_range?: { start: string; end: string };
  departure_day_of_week?: string;
  adult_price?: number;
  child_price?: number;
  status?: string;
  note?: string;
  period_label?: string;
}

export interface SurchargeLike {
  period: string;
  amount_usd?: number;
  amount_krw?: number;
  note: string;
}

/** 출발일 기준 가격 티어 매칭 (특정 날짜 배열 + 기간/요일 룰). */
export function getPriceTierForDate(
  priceTiers: PriceTierLike[],
  departureDate: string,
): PriceTierLike | null {
  if (!priceTiers || priceTiers.length === 0) return null;

  const date = new Date(departureDate);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeek = dayNames[date.getDay()];

  for (const tier of priceTiers) {
    // 특정 날짜 배열 매칭
    if (tier.departure_dates && tier.departure_dates.includes(departureDate)) {
      return tier;
    }
    // 기간 범위 + 요일 매칭
    if (tier.date_range) {
      const start = new Date(tier.date_range.start);
      const end = new Date(tier.date_range.end);
      if (date >= start && date <= end) {
        if (!tier.departure_day_of_week || tier.departure_day_of_week === dayOfWeek) {
          return tier;
        }
      }
    }
  }
  return null;
}

/** 해당 날짜에 적용되는 써차지 합산 (KRW). */
export function getSurchargesForDate(
  surcharges: SurchargeLike[],
  departureDate: string,
  usdToKrw = 1380,
): number {
  if (!surcharges || surcharges.length === 0) return 0;
  const date = new Date(departureDate);
  const year = date.getFullYear();
  let total = 0;

  for (const s of surcharges) {
    // 간단한 기간 파싱 (예: "7/9~7/15", "7/9~15")
    const match = s.period.match(/(\d+)\/(\d+)\s*[~\-]\s*(?:(\d+)\/)?(\d+)/);
    if (match) {
      const startMonth = parseInt(match[1]);
      const startDay = parseInt(match[2]);
      const endMonth = match[3] ? parseInt(match[3]) : startMonth;
      const endDay = parseInt(match[4]);
      const start = new Date(year, startMonth - 1, startDay);
      const end = new Date(year, endMonth - 1, endDay);
      if (date >= start && date <= end) {
        total += (s.amount_krw || 0) + (s.amount_usd || 0) * usdToKrw;
      }
    }
  }
  return total;
}

/** 글로벌 커미션 적용 (기본 9%, env DEFAULT_COMMISSION_RATE 로 오버라이드 가능). */
export function applyCommission(basePrice: number, rate?: number): number {
  const r = rate ?? Number(process.env.DEFAULT_COMMISSION_RATE ?? 9);
  return Math.round(basePrice * (1 + r / 100));
}
