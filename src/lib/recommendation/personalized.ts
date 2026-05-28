/**
 * Personalized Recommendation Engine
 *
 * Reads customer_unified_profile (RFM + 선호도) and computes a per-customer
 * TOPSIS weight override so the search API returns personalised rankings.
 *
 * Architecture:
 *   customer_unified_profile (static)  →  getPersonalizedWeightOverride()
 *   →  scoring/recommend.ts (TOPSIS)   →  personalised search results
 *
 * No profile → safe fallback to global scoring policy.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { ScoringWeights, ScoringPolicy } from '@/lib/scoring/types';

// ── Types ──────────────────────────────────────────────────

export interface CustomerProfileSnapshot {
  customerId: string;
  rfmSegment: string | null;
  preferredDestinations: string[];
  preferredStyles: string[];
  preferredBudgetRange: [number, number] | null;
  preferredTravelMonths: number[];
  preferredPartyType: string | null;
  lifecycleStage: string | null;
  churnRiskLevel: string | null;
  /** Gemini-extended preferences (2026-04-01+) */
  travelPace: string | null;
  dietary: string | null;
  healthNeeds: string | null;
  milestoneDates: string[];
}

export interface PersonalizedWeightOverride {
  weights: Partial<ScoringWeights>;
  boostedDestinations: string[];
  reason: string;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Fetch the customer_unified_profile snapshot.
 * Returns null when the profile does not exist (anonymous / new customer).
 */
export async function getCustomerProfile(
  customerId: string,
): Promise<CustomerProfileSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from('customer_unified_profile')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    customerId,
    rfmSegment: data.rfm_segment ?? null,
    preferredDestinations: data.preferred_destinations ?? [],
    preferredStyles: data.preferred_styles ?? [],
    preferredBudgetRange: data.preferred_budget_range ?? null,
    preferredTravelMonths: data.preferred_travel_months ?? [],
    preferredPartyType: data.preferred_party_type ?? null,
    lifecycleStage: data.lifecycle_stage ?? null,
    churnRiskLevel: data.churn_risk_level ?? null,
    travelPace: data.travel_pace_preference ?? null,
    dietary: data.dietary_restrictions ?? null,
    healthNeeds: data.health_needs ?? null,
    milestoneDates: data.milestone_dates ?? [],
  };
}

/**
 * Compute a personalised weight override from the customer profile.
 *
 * Rules applied:
 *   - price  → adjusted by rfmSegment + lifecycleStage (champions can afford more)
 *   - hotel  → boosted for luxury/filial intent
 *   - meal   → boosted for couple/family
 *   - free_time → boosted for couple
 *   - korean_meal → boosted for filial/senior
 *   - popularity → boosted for at-risk / hibernating (proven destinations)
 *   - shopping_avoidance → boosted for luxury/couple
 */
export function computeWeightOverride(
  profile: CustomerProfileSnapshot,
  basePolicy: ScoringPolicy,
): PersonalizedWeightOverride {
  const w: Partial<ScoringWeights> = {};
  const boostedDestinations: string[] = [];
  const reasons: string[] = [];

  // 1. Segment-based price tolerance
  const priceMultiplier = priceMultiplierBySegment(profile.rfmSegment, profile.lifecycleStage);
  if (priceMultiplier !== 1) {
    w.price = Math.round((basePolicy.weights.price ?? 1) * priceMultiplier * 100) / 100;
    if (priceMultiplier < 1) reasons.push(`가격 민감도 낮춤 (${profile.rfmSegment ?? profile.lifecycleStage ?? '세그먼트'})`);
    else reasons.push(`가격 민감도 높임 (${profile.rfmSegment ?? profile.lifecycleStage ?? '세그먼트'})`);
  }

  // 2. Style-based weight boosts
  const styles = new Set(profile.preferredStyles.map((s) => s.toLowerCase()));

  if (styles.has('luxury') || styles.has('premium')) {
    w.hotel = Math.round(((basePolicy.weights.hotel ?? 1) * 1.25) * 100) / 100;
    w.shopping_avoidance = Math.round(((basePolicy.weights.shopping_avoidance ?? 1) * 1.2) * 100) / 100;
    reasons.push('고급 스타일 선호');
  }
  if (styles.has('couple') || styles.has('romantic')) {
    w.meal = Math.round(((basePolicy.weights.meal ?? 1) * 1.15) * 100) / 100;
    if (basePolicy.weights.free_time != null) {
      w.free_time = Math.round((basePolicy.weights.free_time * 1.2) * 100) / 100;
    }
    reasons.push('커플 스타일 선호');
  }
  if (styles.has('filial') || styles.has('senior') || styles.has('parent')) {
    if (basePolicy.weights.korean_meal != null) {
      w.korean_meal = Math.round((basePolicy.weights.korean_meal * 1.3) * 100) / 100;
    }
    reasons.push('효도/시니어 스타일 선호');
  }
  if (styles.has('budget') || styles.has('cost')) {
    w.price = Math.round(((basePolicy.weights.price ?? 1) * 0.85) * 100) / 100;
    w.hotel = Math.round(((basePolicy.weights.hotel ?? 1) * 0.9) * 100) / 100;
    reasons.push('가성비 스타일 선호');
  }
  if (styles.has('activity') || styles.has('adventure')) {
    if (basePolicy.weights.free_time != null) {
      w.free_time = Math.round((basePolicy.weights.free_time * 0.8) * 100) / 100;
    }
    reasons.push('액티비티 스타일 선호');
  }

  // 3. Boost proven destinations
  if (profile.preferredDestinations.length > 0) {
    boostedDestinations.push(...profile.preferredDestinations.slice(0, 5));
    reasons.push(`${profile.preferredDestinations.length}개 선호 목적지 반영`);
  }

  // 4. Churn risk → prefer popular / safe choices
  if (profile.churnRiskLevel === 'high' || profile.churnRiskLevel === 'medium') {
    if (basePolicy.weights.popularity != null) {
      w.popularity = Math.round((basePolicy.weights.popularity * 1.3) * 100) / 100;
    }
    reasons.push(`이탈 위험 고려 (${profile.churnRiskLevel})`);
  }

  // 5. Travel month alignment (prefer packages in preferred months)
  //    This is handled client-side via the search API month param,
  //    no weight change needed here.

  return {
    weights: Object.keys(w).length > 0 ? w : {},
    boostedDestinations,
    reason: reasons.join(' / ') || '기본 정책',
  };
}

/**
 * Convenience: fetch profile + compute override in one call.
 * Returns null when the customer has no profile (anonymous).
 */
export async function getPersonalizedOverride(
  customerId: string,
  basePolicy: ScoringPolicy,
): Promise<PersonalizedWeightOverride | null> {
  const profile = await getCustomerProfile(customerId);
  if (!profile) return null;
  return computeWeightOverride(profile, basePolicy);
}

// ── Helpers ────────────────────────────────────────────────

function priceMultiplierBySegment(
  rfmSegment: string | null,
  lifecycleStage: string | null,
): number {
  const seg = (rfmSegment ?? '').toLowerCase();
  const stage = (lifecycleStage ?? '').toLowerCase();

  // Champions / loyal → less price sensitive
  if (seg === 'champions' || seg === 'loyal') return 0.9; // 10% less weight on price → higher price tolerance
  // At risk / hibernating → slightly less price sensitive
  if (seg === 'at_risk' || seg === 'hibernating') return 0.95;
  // Lost → more price sensitive (need incentive)
  if (seg === 'lost') return 1.1;

  // Lifecycle fallback
  if (stage === 'churned' || stage === 'at_risk') return 1.05;
  if (stage === 'prospect') return 1.1; // more price sensitive

  return 1;
}
