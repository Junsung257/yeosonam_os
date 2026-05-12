import type { TravelItinerary } from '@/types/itinerary';

// ── 정책 (DB scoring_policies) ──────────────────────────
export interface ScoringWeights {
  // base 6 (v1.0)
  price: number;
  hotel: number;
  meal: number;
  free_options: number;
  shopping_avoidance: number;
  reliability: number;
  // v3.2 P1 (2026-04-30) — Intent 정밀도용 추가 axis. 기존 정책은 0으로 fallback.
  climate_fit?: number;       // destination_climate.fitness (계절 적합도)
  popularity?: number;        // seasonal_signals.popularity (한국인 인기도)
  korean_meal?: number;       // 한식 횟수 (효도·시니어)
  free_time?: number;         // 자유시간 비율 (커플)
}

export const WEIGHT_KEYS: (keyof ScoringWeights)[] = [
  'price', 'hotel', 'meal', 'free_options', 'shopping_avoidance', 'reliability',
  'climate_fit', 'popularity', 'korean_meal', 'free_time',
];

export interface HedonicCoefs {
  shopping_per_count: number;
  meal_per_count: number;
  hotel_grade_step: number;
  computed_from: 'regression' | 'fallback' | 'mixed';
  sample_size: number;
  computed_at: string | null;
}

export interface ScoringFallbackRules {
  min_group_size: number;
  min_regression_samples: number;
  default_shopping_avoidance_per_count: number;
  departure_window_days: number;
  cold_start_window_days?: number;
  cold_start_value_krw?: number;
}

export interface ScoringPolicy {
  id: string;
  version: string;
  is_active: boolean;
  weights: ScoringWeights;
  hotel_premium: Record<string, number>;
  hotel_brand_max_bonus?: number;   // KRW: 동일 성급 내 브랜드 보너스 상한 (default 60,000)
  flight_premium: { direct: number; transit: number };
  hedonic_coefs: HedonicCoefs;
  market_rates: Record<string, number>;
  fallback_rules: ScoringFallbackRules;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── 점수 인풋 ───────────────────────────────────────────
export interface PackageFeatures {
  package_id: string;
  destination: string;
  departure_date: string | null;
  duration_days: number;
  list_price: number;

  shopping_count: number;
  hotel_avg_grade: number | null;
  meal_count: number;
  free_option_count: number;
  is_direct_flight: boolean;
  land_operator_id: string | null;
  reliability_score: number;       // 0.3~1.0 (default 0.7)
  days_since_created: number | null; // 신상품 콜드스타트 부스트용

  // v3 P1 (2026-04-29) — Intent 정밀도 ↑
  confirmation_rate: number;       // 0~1, price_dates.confirmed 비율
  free_time_ratio: number;         // 0~1, 자유시간 schedule 비율
  korean_meal_count: number;       // 한식 횟수 (효도·시니어 신호)
  special_meal_count: number;      // 특식 횟수 (가족·이벤트 신호)
  hotel_location: 'resort' | 'city' | null;  // 커플=resort, 효도=city 가산
  flight_time: 'morning' | 'day' | 'evening' | 'redeye' | null;
  climate_score: number;           // 0-100, destination_climate.fitness_scores 출발월 (default 50)
  popularity_score: number;        // 0-100, seasonal_signals 한국인 인기도 (default 50)

  /** MRT 동기화 DB 평균(0~100). 없으면 null — TOPSIS 호텔 축에 블렌딩 */
  mrt_hotel_quality_score?: number | null;

  itinerary: TravelItinerary | null;
}

// ── 점수 분해 (자비스 답변 사유 생성용) ─────────────────
export interface ScoreDeductions {
  free_options: number;
  hotel_premium: number;
  flight_premium: number;
  shopping_avoidance: number;
  cold_start_boost: number;
}

export interface ScoreBreakdown {
  list_price: number;
  effective_price: number;
  deductions: ScoreDeductions;
  topsis_score: number;
  rank_in_group: number;
  group_size: number;
  why: string[];
  /** 동기화된 MRT 호텔 신호 평균 (자비스·리포트용, null = 미동기화) */
  mrt_hotel_quality_score?: number | null;
}

// ── 정책 검증 ───────────────────────────────────────────
export function isValidPolicy(p: unknown): p is ScoringPolicy {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.version !== 'string') return false;
  const w = o.weights as Record<string, unknown> | undefined;
  if (!w) return false;
  // base 6는 필수, P1 4개는 optional (기존 정책 호환)
  const REQUIRED: (keyof ScoringWeights)[] = ['price', 'hotel', 'meal', 'free_options', 'shopping_avoidance', 'reliability'];
  for (const k of REQUIRED) if (typeof w[k] !== 'number') return false;
  return true;
}
