/**
 * price_dates 단일 진실 소스 — 공통 헬퍼 모듈
 *
 * 날짜 1개 = 가격 1개 = 확정여부 1개
 * 모든 읽기/쓰기 경로가 이 파일을 통해 price_dates를 처리한다.
 */

import type { PriceTier } from './parser';

// ── 타입 ─────────────────────────────────────────────────

export interface PriceDate {
  date: string;          // YYYY-MM-DD
  price: number;         // 성인가격
  child_price?: number;  // 아동가격 (선택)
  confirmed: boolean;    // 출발확정 여부
}

export interface MonthGroup {
  month: string;         // "4월"
  rows: MonthRow[];
}

export interface MonthRow {
  dow: string;           // "목", "일-수", "특정일", "연휴"
  dates: { day: number; confirmed: boolean }[];
  price: number;
  childPrice?: number;
  isLowest: boolean;
  note?: string;
}

// ── Timezone-safe 요일 계산 ─────────────────────────────
// new Date('YYYY-MM-DD') 단독 사용 금지 (UTC 파싱 → KST 하루 밀림)
function safeDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=일 ~ 6=토
}

function safeMonth(dateStr: string): number {
  return parseInt(dateStr.split('-')[1], 10);
}

function safeDay(dateStr: string): number {
  return parseInt(dateStr.split('-')[2], 10);
}

// ── 1. tiersToDatePrices: price_tiers → PriceDate[] (쓰기용) ──

export function tiersToDatePrices(tiers: PriceTier[]): PriceDate[] {
  const seen = new Set<string>();
  const result: PriceDate[] = [];
  const DOW_MAP: Record<string, number> = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  for (const tier of tiers) {
    // soldout tier는 제외 (price_dates에 없는 날짜 = 출발제외일)
    if (tier.status === 'soldout') continue;

    const dates: string[] = [];

    // 1) date_range + departure_day_of_week → 개별 날짜 확장
    const range = (tier as any).date_range as { start: string; end: string } | undefined;
    const dow = (tier as any).departure_day_of_week as string | undefined;
    if (range?.start && range?.end && dow && DOW_MAP[dow] !== undefined) {
      const targetDow = DOW_MAP[dow];
      const [sy, sm, sd] = range.start.split('-').map(Number);
      const [ey, em, ed] = range.end.split('-').map(Number);
      const cursor = new Date(sy, sm - 1, sd);
      const endDate = new Date(ey, em - 1, ed);
      while (cursor <= endDate) {
        if (cursor.getDay() === targetDow) {
          const y = cursor.getFullYear();
          const m = String(cursor.getMonth() + 1).padStart(2, '0');
          const d = String(cursor.getDate()).padStart(2, '0');
          dates.push(`${y}-${m}-${d}`);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // 2) departure_dates (명시적 날짜 배열)
    if (tier.departure_dates) {
      dates.push(...tier.departure_dates);
    }

    // 3) excluded_dates 필터 (tier 레벨)
    const excluded = new Set((tier as any).excluded_dates || []);

    for (const date of dates) {
      if (!date || seen.has(date) || excluded.has(date)) continue;
      seen.add(date);
      result.push({
        date,
        price: tier.adult_price ?? 0,
        ...(tier.child_price ? { child_price: tier.child_price } : {}),
        confirmed: false, // 기본값 false — 확정은 수동 설정
      });
    }
  }

  // 날짜순 정렬 (문자열 비교 — YYYY-MM-DD 포맷이므로 안전)
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

// ── 2. getEffectivePriceDates: 읽기 진입점 (폴백 포함) ──
// @deprecated Phase 4 목표: Phase 3 마이그레이션 완료 후 getStrictPriceDates로 교체

export function getEffectivePriceDates(pkg: {
  price_dates?: PriceDate[];
  price_tiers?: PriceTier[];
}): PriceDate[] {
  if (pkg.price_dates && Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0) {
    return pkg.price_dates;
  }
  return tiersToDatePrices(pkg.price_tiers || []);
}

// ── 2-b. getStrictPriceDates: price_dates만 사용, 없으면 에러 로그 + 빈 배열 ──
// Phase 3 이후 신규 경로는 이 함수 사용. 폴백 없음으로 데이터 불일치 원천 차단.

export function getStrictPriceDates(pkg: {
  id?: string;
  price_dates?: PriceDate[];
}): PriceDate[] {
  if (pkg.price_dates && Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0) {
    return pkg.price_dates;
  }
  if (typeof console !== 'undefined') {
    console.warn(`[price-dates] getStrictPriceDates: price_dates 비어있음 (pkg.id=${pkg.id ?? 'unknown'}). migrate_tiers_to_dates.js 실행 필요.`);
  }
  return [];
}

// ── 3. groupForPoster: 포스터용 자동 그룹핑 알고리즘 ──

const DOW_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function groupForPoster(dates: PriceDate[]): MonthGroup[] {
  if (dates.length === 0) return [];

  // 전체 최저가
  const allPrices = dates.map(d => d.price).filter(p => p > 0);
  const globalMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;

  // Step 1: 월별 분리
  const byMonth = new Map<number, PriceDate[]>();
  for (const d of dates) {
    const m = safeMonth(d.date);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(d);
  }

  const result: MonthGroup[] = [];

  for (const [monthNum, monthDates] of byMonth) {
    // Step 2: 같은 월 내에서 가격별 그룹
    const byPrice = new Map<number, PriceDate[]>();
    for (const d of monthDates) {
      if (!byPrice.has(d.price)) byPrice.set(d.price, []);
      byPrice.get(d.price)!.push(d);
    }

    const rows: MonthRow[] = [];

    for (const [price, priceDates] of byPrice) {
      // Step 3: 같은 가격 내에서 요일별 서브그룹 분리
      // 먼저 개별 요일로 분류
      const byDow = new Map<number, PriceDate[]>(); // 0=일 ~ 6=토
      for (const pd of priceDates) {
        const d = safeDayOfWeek(pd.date);
        if (!byDow.has(d)) byDow.set(d, []);
        byDow.get(d)!.push(pd);
      }

      // 일~수(0,1,2,3) 병합 가능한지 체크
      const sunToWed = [0, 1, 2, 3];
      const sunToWedDows = sunToWed.filter(d => byDow.has(d));
      const otherDows = [...byDow.keys()].filter(d => !sunToWed.includes(d));

      // 서브그룹 생성
      const subGroups: { label: string; dates: PriceDate[] }[] = [];

      // 일~수 그룹 (2개 이상이면 "일-수"로 병합)
      if (sunToWedDows.length >= 2) {
        const merged: PriceDate[] = [];
        for (const d of sunToWedDows) {
          merged.push(...byDow.get(d)!);
        }
        subGroups.push({ label: '일-수', dates: merged });
      } else {
        // 1개 이하면 개별 요일로
        for (const d of sunToWedDows) {
          subGroups.push({ label: DOW_NAMES[d], dates: byDow.get(d)! });
        }
      }

      // 나머지 요일은 개별 행
      for (const d of otherDows.sort((a, b) => a - b)) {
        subGroups.push({ label: DOW_NAMES[d], dates: byDow.get(d)! });
      }

      // Step 4: 각 서브그룹을 행으로
      for (const sg of subGroups) {
        const dayEntries = sg.dates.map(pd => ({
          day: safeDay(pd.date),
          confirmed: pd.confirmed,
        }));
        dayEntries.sort((a, b) => a.day - b.day);

        const childPrice = sg.dates[0]?.child_price;

        rows.push({
          dow: sg.label,
          dates: dayEntries,
          price,
          ...(childPrice ? { childPrice } : {}),
          isLowest: price === globalMin && globalMin > 0,
        });
      }
    }

    // 가격 오름차순 → 같은 가격이면 첫 날짜 오름차순
    rows.sort((a, b) => a.price - b.price || (a.dates[0]?.day ?? 0) - (b.dates[0]?.day ?? 0));

    result.push({ month: `${monthNum}월`, rows });
  }

  return result;
}

function detectDowPattern(dowSet: Set<number>): string {
  if (dowSet.size === 0) return '특정일';
  if (dowSet.size === 1) {
    return DOW_NAMES[[...dowSet][0]];
  }

  // 일~수 패턴 체크 (0,1,2,3)
  const sunToWed = new Set([0, 1, 2, 3]);
  if (dowSet.size <= 4 && [...dowSet].every(d => sunToWed.has(d))) {
    return '일-수';
  }

  // 월~금 체크
  const monToFri = new Set([1, 2, 3, 4, 5]);
  if (dowSet.size <= 5 && [...dowSet].every(d => monToFri.has(d))) {
    return '월-금';
  }

  // 2개 요일 나열 (예: "수,목")
  if (dowSet.size === 2) {
    const sorted = [...dowSet].sort((a, b) => a - b);
    return sorted.map(d => DOW_NAMES[d]).join(',');
  }

  return '특정일';
}

// ── 4. getMinPriceFromDates ──

export function getMinPriceFromDates(dates: PriceDate[]): number {
  const prices = dates.map(d => d.price).filter(p => p > 0);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

// ── 5. getNextDepartureFromDates ──

export function getNextDepartureFromDates(dates: PriceDate[]): string | null {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const future = dates.filter(d => d.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date));
  return future[0]?.date || null;
}
