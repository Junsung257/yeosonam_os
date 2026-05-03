import type { TravelItinerary } from '@/types/itinerary';
import type { PackageFeatures } from './types';

const HOTEL_GRADE_LABEL_MAP: Record<string, number> = {
  '3성': 3.0, '준4성': 3.5, '4성': 4.0,
  '준5성': 4.5, '5성': 5.0, '특급': 5.0, '디럭스': 4.5, '슈페리어': 4.0,
};

export function parseHotelGrade(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const trimmed = grade.trim();
  if (HOTEL_GRADE_LABEL_MAP[trimmed] !== undefined) return HOTEL_GRADE_LABEL_MAP[trimmed];
  const m = trimmed.match(/(\d+(?:\.\d+)?)\s*성/);
  if (m) {
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 5) return /준/.test(trimmed) ? Math.max(1, v - 0.5) : v;
  }
  return null;
}

export function avgHotelGrade(itinerary: TravelItinerary | null): number | null {
  if (!itinerary) return null;
  const grades = (itinerary.days ?? [])
    .map(d => parseHotelGrade(d.hotel?.grade ?? null))
    .filter((g): g is number => g !== null);
  if (grades.length === 0) return null;
  return grades.reduce((a, b) => a + b, 0) / grades.length;
}

export function countMeals(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  let cnt = 0;
  for (const d of itinerary.days ?? []) {
    if (d.meals?.breakfast) cnt++;
    if (d.meals?.lunch) cnt++;
    if (d.meals?.dinner) cnt++;
  }
  return cnt;
}

/**
 * 쇼핑 횟수 추출. "강제쇼핑" 워딩 안 씀 — 쇼핑은 패키지 구성요소.
 * 1순위: highlights.shopping 텍스트의 "N회"
 * 2순위: schedule[].type === 'shopping' 카운트
 */
export function countShopping(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  const txt = itinerary.highlights?.shopping;
  if (txt) {
    const m = txt.match(/(\d+)\s*회/);
    if (m) return parseInt(m[1], 10);
    if (/없음|無|x|0회/i.test(txt)) return 0;
  }
  let cnt = 0;
  for (const d of itinerary.days ?? []) {
    for (const s of d.schedule ?? []) {
      if (s.type === 'shopping') cnt++;
    }
  }
  return cnt;
}

/**
 * 무료 포함 옵션 개수.
 * 1순위: optional_tour.price=0
 * 2순위: inclusions 텍스트에 옵션명 포함
 */
export function countFreeOptions(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  const tours = itinerary.optional_tours ?? [];
  if (tours.length === 0) return 0;
  const inclusionsText = (itinerary.highlights?.inclusions ?? []).join(' ').toLowerCase();
  let cnt = 0;
  for (const t of tours) {
    if (!t.name) continue;
    const isFree = (t.price_krw === 0 || t.price_usd === 0)
      || inclusionsText.includes(t.name.toLowerCase());
    if (isFree) cnt++;
  }
  return cnt;
}

export function isDirectFlight(itinerary: TravelItinerary | null): boolean {
  if (!itinerary) return false;
  const remarks = (itinerary.highlights?.remarks ?? []).join(' ');
  if (/경유|transit|stopover|환승/i.test(remarks)) return false;
  return !!itinerary.meta?.flight_out;
}

// ─── P1 신규 features (2026-04-29) ─────────────────────────────────

/**
 * 출확정율 — price_dates 중 confirmed=true 비율 (0~1).
 * 신뢰 신호: 0.7 이상이면 안심 (대부분 출발 보장).
 */
export function confirmationRate(priceDates?: Array<{ confirmed?: boolean }> | null): number {
  if (!Array.isArray(priceDates) || priceDates.length === 0) return 0;
  const confirmed = priceDates.filter(d => d?.confirmed === true).length;
  return confirmed / priceDates.length;
}

/**
 * 자유시간 비율 — schedule items 중 자유시간/휴식 키워드 비율.
 * 커플 = 높을수록 ↑, 가족 = 적당히, 효도 = 무관.
 */
export function freeTimeRatio(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  let total = 0, freeCount = 0;
  for (const d of itinerary.days ?? []) {
    for (const s of d.schedule ?? []) {
      total++;
      if (/자유시간|자유일정|휴식|free|leisure|쇼핑가능|개인시간/i.test(s.activity ?? '')) freeCount++;
    }
  }
  return total > 0 ? freeCount / total : 0;
}

/**
 * 한식 횟수 — meals notes / schedule에서 한식 키워드.
 * 효도·시니어·가족 강한 신호.
 */
export function koreanMealCount(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  let cnt = 0;
  const KOREAN_RE = /한식|한정식|불고기|삼겹살|김치|비빔밥|쌈밥|돼지갈비|소불고기|닭볶음|순두부|제육|순대|보쌈|족발|국밥|곰탕|냉면|떡볶이|갈비탕|짜장|짬뽕|찌개/i;
  for (const d of itinerary.days ?? []) {
    const m = d.meals ?? {};
    for (const slot of [m.breakfast_note, m.lunch_note, m.dinner_note]) {
      if (slot && KOREAN_RE.test(slot)) cnt++;
    }
    for (const s of d.schedule ?? []) {
      if (s.activity && KOREAN_RE.test(s.activity) && /식사|중식|석식|조식|특식/.test(s.activity)) cnt++;
    }
  }
  return cnt;
}

/**
 * 특식 횟수 — highlights 또는 day notes에서 "특식" 명시.
 * "삼겹살 무제한", "훠궈" 같은 명시 메뉴는 특식으로 카운트.
 */
export function specialMealCount(itinerary: TravelItinerary | null): number {
  if (!itinerary) return 0;
  let cnt = 0;
  const SPECIAL_RE = /특식|훠궈|하이디라오|샤브샤브|랍스터|딤섬|광동|북경오리|가이세키|오마카세|와규|장어|회|초밥|뷔페|stake|스테이크|불고기|무제한/i;
  // highlights 명시 카운트
  const highlights = (itinerary.highlights as unknown as { specials?: string[]; meals?: string[] })?.specials ?? (itinerary.highlights as unknown as { specials?: string[]; meals?: string[] })?.meals ?? [];
  if (Array.isArray(highlights)) cnt += highlights.length;
  // day-level meals notes 추가 매칭
  for (const d of itinerary.days ?? []) {
    const m = d.meals ?? {};
    for (const slot of [m.breakfast_note, m.lunch_note, m.dinner_note]) {
      if (slot && SPECIAL_RE.test(slot)) cnt++;
    }
  }
  return cnt;
}

/**
 * 호텔 위치 분류 — 'resort' (리조트/근교 휴양형) | 'city' (시내·도심) | null
 * hotel.note 또는 호텔명에서 키워드로 판단.
 * 커플 = resort 가산, 효도 = city 가산 (이동 부담 ↓).
 */
export function hotelLocationType(itinerary: TravelItinerary | null): 'resort' | 'city' | null {
  if (!itinerary) return null;
  let resortHits = 0, cityHits = 0;
  const RESORT_RE = /리조트|resort|풀빌라|풀\s*빌라|villa|빈펄|올인클루시브|all\s*inclusive|비치|해변|섬|island/i;
  const CITY_RE = /시내|도심|중심|downtown|시티호텔|city\s*hotel|역세권|광장|metro/i;
  for (const d of itinerary.days ?? []) {
    const text = `${d.hotel?.name ?? ''} ${d.hotel?.note ?? ''}`;
    if (RESORT_RE.test(text)) resortHits++;
    if (CITY_RE.test(text)) cityHits++;
  }
  if (resortHits > cityHits && resortHits > 0) return 'resort';
  if (cityHits > resortHits && cityHits > 0) return 'city';
  return null;
}

/**
 * 항공 시간대 분류 — 'morning' (06-11시), 'day' (12-17), 'evening' (18-22), 'redeye' (23-05) | null
 * itinerary.meta.flight_out_time (HH:MM) 기반. 가족 = morning/day 가산, 커플 = 무관.
 */
export function flightTimeCategory(itinerary: TravelItinerary | null): 'morning' | 'day' | 'evening' | 'redeye' | null {
  const t = itinerary?.meta?.flight_out;
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/(\d{1,2}):?(\d{2})?/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (!Number.isFinite(h)) return null;
  if (h >= 6 && h <= 11) return 'morning';
  if (h >= 12 && h <= 17) return 'day';
  if (h >= 18 && h <= 22) return 'evening';
  return 'redeye';
}

export interface RawPackageRow {
  id: string;
  destination: string;
  /** 실 스키마: travel_packages.duration (별도 departure_date 컬럼 없음 — price_dates jsonb에서 첫 미래 출발일 추출) */
  duration: number | null;
  price: number | null;
  /** [{ date, price, child_price?, confirmed }] — 첫 미래 출발일 산출용 */
  price_dates?: Array<{ date?: string; price?: number; confirmed?: boolean }> | null;
  itinerary_data: TravelItinerary | null;
  land_operator_id?: string | null;
  created_at?: string | null;
  /** v3 P1: climate_fitness 점수 (출발월 기준) — destination_climate에서 join. 없으면 50 fallback */
  climate_score?: number | null;
  /** v3 P1: 한국인 인기도 (출발월 기준) — seasonal_signals에서 join. 없으면 50 fallback */
  popularity_score?: number | null;
}

/** price_dates에서 가장 가까운 미래 출발일 (없으면 가장 빠른 출발일) — 점수·MRT 동기화 공통 */
export function pickPackageRepresentativeDate(price_dates?: RawPackageRow['price_dates']): string | null {
  if (!Array.isArray(price_dates) || price_dates.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const dates = price_dates.map(d => d?.date).filter((v): v is string => !!v).sort();
  if (dates.length === 0) return null;
  return dates.find(d => d >= today) ?? dates[0] ?? null;
}

/** price_dates에서 최저가 (정해진 list_price가 없을 때 폴백) */
function pickMinPrice(price_dates?: RawPackageRow['price_dates']): number | null {
  if (!Array.isArray(price_dates) || price_dates.length === 0) return null;
  const prices = price_dates.map(d => d?.price).filter((v): v is number => typeof v === 'number' && v > 0);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

/**
 * 출발일별 features 추출 (v3, 2026-04-29).
 * 한 패키지의 N개 price_dates 각각 → N개 features 행.
 * @param overrideDate 특정 출발일로 features 산출 (이 날의 가격 사용). null = 대표일
 */
export function extractPackageFeatures(
  pkg: RawPackageRow,
  reliabilityByOperator?: Map<string, number>,
  overrideDate?: string | null,
): PackageFeatures {
  const itin = pkg.itinerary_data;
  const operatorId = pkg.land_operator_id ?? null;
  const reliability = operatorId
    ? (reliabilityByOperator?.get(operatorId) ?? 0.7)
    : 0.7;
  let daysSince: number | null = null;
  if (pkg.created_at) {
    const ms = Date.now() - new Date(pkg.created_at).getTime();
    if (Number.isFinite(ms) && ms >= 0) daysSince = Math.floor(ms / 86400000);
  }
  // overrideDate가 주어지면 그 날의 가격, 아니면 representative
  const usedDate = overrideDate ?? pickPackageRepresentativeDate(pkg.price_dates);
  let listPrice = pkg.price ?? pickMinPrice(pkg.price_dates) ?? 0;
  if (overrideDate && Array.isArray(pkg.price_dates)) {
    const match = pkg.price_dates.find(d => d?.date === overrideDate);
    if (match?.price && match.price > 0) listPrice = match.price;
  }
  return {
    package_id: pkg.id,
    destination: pkg.destination,
    departure_date: usedDate,
    duration_days: pkg.duration ?? itin?.meta?.days ?? 0,
    list_price: listPrice,
    confirmation_rate: confirmationRate(pkg.price_dates),
    free_time_ratio: freeTimeRatio(itin),
    korean_meal_count: koreanMealCount(itin),
    special_meal_count: specialMealCount(itin),
    hotel_location: hotelLocationType(itin),
    flight_time: flightTimeCategory(itin),
    climate_score: pkg.climate_score ?? 50,
    popularity_score: pkg.popularity_score ?? 50,
    shopping_count: countShopping(itin),
    hotel_avg_grade: avgHotelGrade(itin),
    meal_count: countMeals(itin),
    free_option_count: countFreeOptions(itin),
    is_direct_flight: isDirectFlight(itin),
    land_operator_id: operatorId,
    reliability_score: reliability,
    days_since_created: daysSince,
    itinerary: itin,
  };
}
