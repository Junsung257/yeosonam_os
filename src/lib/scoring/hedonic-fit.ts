import { supabaseAdmin } from '@/lib/supabase';
import { invalidatePolicyCache } from './policy';
import type { ScoringPolicy } from './types';

export interface HedonicFitResult {
  shopping_per_count: number;
  meal_per_count: number;
  hotel_grade_step: number;
  sample_size: number;
  computed_from: 'regression' | 'fallback' | 'mixed';
  computed_at: string;
}

/**
 * 단변량 OLS로 implicit price 학습:
 *   β = Cov(x, price) / Var(x)
 * 쇼핑은 음의 계수 기대(쇼핑↑ 가격↓), 식사·호텔은 양의 계수 기대.
 *
 * 다중회귀가 아닌 이유: 표본 적을 때 안전. 그룹 내 비교에 충분.
 * sanity check + 폴백 EMA 결합으로 안정화.
 */
export async function fitHedonicCoefs(opts: {
  ema_weight?: number;
  min_samples?: number;
} = {}): Promise<HedonicFitResult> {
  const minSamples = opts.min_samples ?? 20;
  const ema = Math.min(1, Math.max(0, opts.ema_weight ?? 0.5));

  const { data: polData, error: polErr } = await supabaseAdmin
    .from('scoring_policies').select('*').eq('is_active', true).limit(1);
  if (polErr) throw polErr;
  if (!polData?.[0]) throw new Error('활성 정책 없음');
  const policy = polData[0] as ScoringPolicy;

  const fallback = {
    shopping_per_count: policy.fallback_rules?.default_shopping_avoidance_per_count ?? 50000,
    meal_per_count: 15000,
    hotel_grade_step: 30000,
  };

  const { data, error } = await supabaseAdmin
    .from('package_scores')
    .select('shopping_count, hotel_avg_grade, meal_count, breakdown')
    .limit(5000);
  if (error) throw new Error(`헤도닉 학습 데이터 로드 실패: ${error.message}`);

  type Row = { shopping_count: number; hotel_avg_grade: number | null; meal_count: number; breakdown: Record<string, unknown> };
  const rows = ((data ?? []) as Row[]).filter(r => {
    const lp = (r.breakdown as { list_price?: number })?.list_price;
    return typeof lp === 'number' && lp > 0;
  });

  const computedAt = new Date().toISOString();

  if (rows.length < minSamples) {
    await persistCoefs(policy.id, { ...fallback, sample_size: rows.length, computed_from: 'fallback', computed_at: computedAt });
    return { ...fallback, sample_size: rows.length, computed_from: 'fallback', computed_at: computedAt };
  }

  const ols = (xs: number[], ys: number[]): number => {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let cov = 0, varx = 0;
    for (let i = 0; i < n; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      varx += (xs[i] - mx) ** 2;
    }
    return varx === 0 ? 0 : cov / varx;
  };

  const prices = rows.map(r => (r.breakdown as { list_price: number }).list_price);
  const shopBeta = ols(rows.map(r => r.shopping_count), prices);
  const mealBeta = ols(rows.map(r => r.meal_count), prices);
  const hotelXs = rows.map(r => r.hotel_avg_grade ?? 3.0);
  const hotelBeta = ols(hotelXs, prices);

  const fit = {
    shopping_per_count: Math.max(0, -shopBeta), // 음의 계수 → 양의 회피 가치
    meal_per_count: Math.max(0, mealBeta),
    hotel_grade_step: Math.max(0, hotelBeta),
  };

  const merged = {
    shopping_per_count: ema * fit.shopping_per_count + (1 - ema) * fallback.shopping_per_count,
    meal_per_count: ema * fit.meal_per_count + (1 - ema) * fallback.meal_per_count,
    hotel_grade_step: ema * fit.hotel_grade_step + (1 - ema) * fallback.hotel_grade_step,
  };

  const sane = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  const result: HedonicFitResult = {
    shopping_per_count: sane(merged.shopping_per_count, 5000, 200000)
      ? Math.round(merged.shopping_per_count) : fallback.shopping_per_count,
    meal_per_count: sane(merged.meal_per_count, 1000, 100000)
      ? Math.round(merged.meal_per_count) : fallback.meal_per_count,
    hotel_grade_step: sane(merged.hotel_grade_step, 5000, 300000)
      ? Math.round(merged.hotel_grade_step) : fallback.hotel_grade_step,
    sample_size: rows.length,
    computed_from: 'mixed',
    computed_at: computedAt,
  };

  await persistCoefs(policy.id, result);
  return result;
}

async function persistCoefs(policyId: string, coefs: HedonicFitResult): Promise<void> {
  const { error } = await supabaseAdmin
    .from('scoring_policies')
    .update({
      hedonic_coefs: {
        shopping_per_count: coefs.shopping_per_count,
        meal_per_count: coefs.meal_per_count,
        hotel_grade_step: coefs.hotel_grade_step,
        computed_from: coefs.computed_from,
        sample_size: coefs.sample_size,
        computed_at: coefs.computed_at,
      },
    })
    .eq('id', policyId);
  if (error) throw new Error(`헤도닉 갱신 실패: ${error.message}`);
  invalidatePolicyCache();
}
