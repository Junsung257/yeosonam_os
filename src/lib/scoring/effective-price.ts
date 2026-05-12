import type { PackageFeatures, ScoringPolicy, ScoreDeductions } from './types';
import { parseHotelGrade } from './extract-features';
import { type HotelBrandEntry, matchBrandScore } from './hotel-brands';

export interface EffectivePriceResult {
  effective_price: number;
  deductions: ScoreDeductions;
  why: string[];
}

const fmtKRW = (n: number) => `${(n / 10000).toFixed(1)}만`;

/**
 * Hedonic decomposition — 표시가에서 시장가 환산값을 차감/가산해 "실효가격" 산출.
 *
 *   effective_price = list_price
 *                   - free_options_value     (무료 포함 옵션 시장가)
 *                   - hotel_premium          (호텔 등급 등가 금액)
 *                   - flight_premium         (직항 보너스)
 *                   + shopping_avoidance     (쇼핑 N회 × implicit price)
 *
 * 쇼핑은 페널티가 아니라 "회피 가치" 환산. 쇼핑 0회면 가산 0.
 * implicit price는 헤도닉 회귀로 매일 갱신.
 */
export function computeEffectivePrice(
  features: PackageFeatures,
  policy: ScoringPolicy,
  brandEntries?: HotelBrandEntry[],
): EffectivePriceResult {
  const free_options = computeFreeOptionsValue(features, policy);
  const hotel_premium = computeHotelPremium(features, policy, brandEntries);
  const flight_premium = features.is_direct_flight
    ? (policy.flight_premium?.direct ?? 0)
    : (policy.flight_premium?.transit ?? 0);
  const shopping_avoidance = computeShoppingAvoidanceCost(features, policy);
  const cold_start_boost = computeColdStartBoost(features, policy);

  const effective_price = Math.max(
    0,
    features.list_price - free_options - hotel_premium - flight_premium - cold_start_boost + shopping_avoidance,
  );

  const why: string[] = [];
  if (free_options > 0) why.push(`무료 옵션 ${fmtKRW(free_options)} 가치`);
  if (hotel_premium > 0) {
    const brandNote = brandEntries && brandEntries.length > 0 ? ' (브랜드 보너스 포함)' : '';
    why.push(`호텔 등급 ${fmtKRW(hotel_premium)} 환산${brandNote}`);
  }
  if (flight_premium > 0 && features.is_direct_flight) why.push(`직항 ${fmtKRW(flight_premium)} 가치`);
  if (features.shopping_count > 0) why.push(`쇼핑 ${features.shopping_count}회 +${fmtKRW(shopping_avoidance)}`);
  if (features.shopping_count === 0) why.push(`쇼핑 일정 없음`);
  if (cold_start_boost > 0) why.push(`신상품 ${fmtKRW(cold_start_boost)} 가산`);

  return {
    effective_price,
    deductions: { free_options, hotel_premium, flight_premium, shopping_avoidance, cold_start_boost },
    why,
  };
}

export function computeColdStartBoost(
  features: PackageFeatures,
  policy: ScoringPolicy,
): number {
  const window = policy.fallback_rules?.cold_start_window_days ?? 0;
  const value = policy.fallback_rules?.cold_start_value_krw ?? 0;
  if (window <= 0 || value <= 0) return 0;
  if (features.days_since_created === null) return 0;
  if (features.days_since_created > window) return 0;
  // 등록 시점 가까울수록 풀 보너스, window 끝날수록 감소 (선형)
  const ratio = 1 - (features.days_since_created / window);
  return Math.max(0, Math.round(value * ratio));
}

export function computeHotelPremium(
  features: PackageFeatures,
  policy: ScoringPolicy,
  brandEntries?: HotelBrandEntry[],
): number {
  const itin = features.itinerary;
  if (!itin) return 0;
  const days = itin.days ?? [];
  if (days.length === 0) return 0;

  const maxBonus = policy.hotel_brand_max_bonus ?? 60000;

  let total = 0;
  let nights = 0;
  for (const d of days) {
    const label = d.hotel?.grade?.trim();
    if (!label) continue;

    // 등급 기본 프리미엄
    let gradeBase: number;
    if (policy.hotel_premium[label] !== undefined) {
      gradeBase = policy.hotel_premium[label];
    } else {
      const numGrade = parseHotelGrade(label);
      if (numGrade === null) continue;
      gradeBase = Math.max(0, (numGrade - 3) * (policy.hedonic_coefs?.hotel_grade_step ?? 30000));
    }

    // 브랜드 보너스: score 0.5 → 0원, score 1.0 → maxBonus원
    // 미매칭(null) → 0원 (중립, 페널티 없음)
    let brandBonus = 0;
    if (maxBonus > 0 && brandEntries && brandEntries.length > 0 && d.hotel?.name) {
      const numGrade = parseHotelGrade(label) ?? 4;
      const score = matchBrandScore(d.hotel.name, numGrade, brandEntries);
      if (score !== null && score > 0.5) {
        brandBonus = (score - 0.5) * maxBonus * 2;
      }
    }

    total += gradeBase + brandBonus;
    nights++;
  }
  return nights > 0 ? total : 0;
}

export function computeFreeOptionsValue(
  features: PackageFeatures,
  policy: ScoringPolicy,
): number {
  const itin = features.itinerary;
  if (!itin) return 0;
  const tours = itin.optional_tours ?? [];
  if (tours.length === 0) return 0;
  const inclusionsText = (itin.highlights?.inclusions ?? []).join(' ').toLowerCase();
  const dest = features.destination;
  const fallbackRate = 50000;

  let total = 0;
  for (const t of tours) {
    if (!t.name) continue;
    const isFree = (t.price_krw === 0 || t.price_usd === 0)
      || inclusionsText.includes(t.name.toLowerCase());
    if (!isFree) continue;

    let rate = 0;
    const candidates = [`${dest}|${t.name}`, t.name];
    for (const k of candidates) {
      const v = policy.market_rates?.[k];
      if (typeof v === 'number' && v > 0) { rate = v; break; }
    }
    if (rate === 0 && typeof t.price_krw === 'number' && t.price_krw > 0) rate = t.price_krw;
    if (rate === 0) rate = fallbackRate;
    total += rate;
  }
  return total;
}

export function computeShoppingAvoidanceCost(
  features: PackageFeatures,
  policy: ScoringPolicy,
): number {
  const perCount = policy.hedonic_coefs?.shopping_per_count
    ?? policy.fallback_rules?.default_shopping_avoidance_per_count
    ?? 50000;
  return Math.max(0, features.shopping_count) * perCount;
}
