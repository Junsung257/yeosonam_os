import { describe, it, expect } from 'vitest';
import { computeEffectivePrice } from './effective-price';
import type { PackageFeatures, ScoringPolicy } from './types';

const POLICY: ScoringPolicy = {
  id: 'p1',
  version: 'v1.0-test',
  is_active: true,
  weights: { price: 0.475, hotel: 0.190, meal: 0.095, free_options: 0.095, shopping_avoidance: 0.095, reliability: 0.050 },
  hotel_premium: { '3성': 0, '4성': 70000, '5성': 150000 },
  flight_premium: { direct: 50000, transit: 0 },
  hedonic_coefs: {
    shopping_per_count: 50000, meal_per_count: 15000, hotel_grade_step: 30000,
    computed_from: 'fallback', sample_size: 0, computed_at: null,
  },
  market_rates: { '2층버스': 50000, '스파마사지': 80000 },
  fallback_rules: {
    min_group_size: 2, min_regression_samples: 20,
    default_shopping_avoidance_per_count: 50000, departure_window_days: 3,
    cold_start_window_days: 30, cold_start_value_krw: 50000,
  },
};

const baseFeatures = (over: Partial<PackageFeatures>): PackageFeatures => ({
  package_id: 'pkg', destination: '다낭', departure_date: '2026-04-20',
  duration_days: 5, list_price: 500000,
  shopping_count: 0, hotel_avg_grade: 3.0, meal_count: 5,
  free_option_count: 0, is_direct_flight: true,
  land_operator_id: null, reliability_score: 0.7,
  days_since_created: null, confirmation_rate: 0, free_time_ratio: 0,
  korean_meal_count: 0, special_meal_count: 0, hotel_location: null,
  flight_time: null, climate_score: 50, popularity_score: 50,
  itinerary: null, ...over,
});

describe('computeEffectivePrice', () => {
  it('Da Nang C case — 50만 표시, 5성+무료4옵션+직항+쇼핑0 → 실효 매우 낮음', () => {
    const f = baseFeatures({
      list_price: 500000, shopping_count: 0,
      hotel_avg_grade: 5.0, free_option_count: 4, is_direct_flight: true,
      itinerary: {
        meta: { destination: '다낭', nights: 4, days: 5, brand: '여소남' } as never,
        highlights: { inclusions: ['2층버스', '스파마사지'], excludes: [], shopping: '쇼핑 0회', remarks: [] } as never,
        days: [{
          day: 1, regions: [], meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: null, lunch_note: null, dinner_note: null },
          schedule: [], hotel: { name: 'X', grade: '5성', note: null },
        }] as never,
        optional_tours: [
          { name: '2층버스', price_krw: 0, price_usd: null, note: null },
          { name: '스파마사지', price_krw: 0, price_usd: null, note: null },
          { name: 'A', price_krw: 0, price_usd: null, note: null },
          { name: 'B', price_krw: 0, price_usd: null, note: null },
        ],
      } as never,
    });
    const r = computeEffectivePrice(f, POLICY);
    // 50만 - 무료옵션(50k+80k+50k+50k=230k) - 호텔5성(150k) - 직항(50k) + 쇼핑0(0) = 70k
    expect(r.effective_price).toBeLessThan(100000);
    expect(r.deductions.free_options).toBe(230000);
    expect(r.deductions.shopping_avoidance).toBe(0);
    expect(r.why).toContain('쇼핑 일정 없음');
  });

  it('A case — 30만 표시, 3성+쇼핑3 → 실효 가산되어 더 비싸짐', () => {
    const f = baseFeatures({
      list_price: 300000, shopping_count: 3,
      hotel_avg_grade: 3.0, free_option_count: 0, is_direct_flight: true,
    });
    const r = computeEffectivePrice(f, POLICY);
    // 300k - 0 - 0 - 50k(직항) + 150k(쇼핑3×50k) = 400k
    expect(r.effective_price).toBe(400000);
    expect(r.deductions.shopping_avoidance).toBe(150000);
  });

  it('shopping 0 — no shopping_avoidance cost', () => {
    const f = baseFeatures({ shopping_count: 0 });
    const r = computeEffectivePrice(f, POLICY);
    expect(r.deductions.shopping_avoidance).toBe(0);
  });

  it('non-negative effective price', () => {
    const f = baseFeatures({ list_price: 100, hotel_avg_grade: 5.0, free_option_count: 10, is_direct_flight: true });
    const r = computeEffectivePrice(f, POLICY);
    expect(r.effective_price).toBeGreaterThanOrEqual(0);
  });

  it('cold start boost — 등록 10일차면 약 33% 보너스', () => {
    const f = baseFeatures({ list_price: 500000, days_since_created: 10 });
    const r = computeEffectivePrice(f, POLICY);
    // 50000 * (1 - 10/30) ≈ 33333
    expect(r.deductions.cold_start_boost).toBeGreaterThan(30000);
    expect(r.deductions.cold_start_boost).toBeLessThan(35000);
    expect(r.why.some(s => s.includes('신상품'))).toBe(true);
  });

  it('cold start boost — 등록 40일차면 0 (window 밖)', () => {
    const f = baseFeatures({ list_price: 500000, days_since_created: 40 });
    const r = computeEffectivePrice(f, POLICY);
    expect(r.deductions.cold_start_boost).toBe(0);
  });

  it('cold start boost — created_at 없으면 0', () => {
    const f = baseFeatures({ list_price: 500000, days_since_created: null });
    const r = computeEffectivePrice(f, POLICY);
    expect(r.deductions.cold_start_boost).toBe(0);
  });
});
