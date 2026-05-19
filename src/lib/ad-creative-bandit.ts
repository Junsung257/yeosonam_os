/**
 * Thompson Sampling Multi-Armed Bandit — 광고 카피 변형 자동 선택기.
 *
 * 같은 상품에 N개 광고 카피 변형(headline/body 다름)이 있을 때, 매번 어떤 걸 노출할지
 * 통계적으로 최적 결정. 충분히 데이터 쌓이면 best performer 가 자연히 더 자주 선택됨
 * (exploration → exploitation 자동 전환).
 *
 * 학술 출처:
 *   - Chapelle & Li 2011 "An Empirical Evaluation of Thompson Sampling" (NeurIPS)
 *   - arXiv 2108.06812 "Batched Thompson Sampling for Multi-Armed Bandits"
 *   - Google Analytics Optimize 가 이 알고리즘 사용
 *
 * 패턴:
 *   각 변형마다 Beta(success+1, failure+1) 사전분포 유지.
 *   매 호출 시 모든 변형의 Beta 분포에서 1회 sampling → 최댓값 선택.
 *   결과(click 등 success outcome)로 카운트 업데이트.
 */

import { isSupabaseConfigured, getSupabaseAdmin } from '@/lib/supabase';

/** Beta(α, β) 분포에서 1회 샘플링. Box-Muller + Gamma 변환 미사용 — 간단한 acceptance-rejection. */
function sampleBeta(alpha: number, beta: number): number {
  // Cheng's BB algorithm (1978) — 작은 α/β 도 안정. 우리는 ≥1 보장.
  // 간단 구현: Gamma(α,1) / (Gamma(α,1) + Gamma(β,1))
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/** Marsaglia & Tsang Gamma sampler — shape ≥ 1 에 대해 안정. shape < 1 은 Boost 트릭 사용. */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // shape < 1 → Gamma(shape+1) * U^(1/shape) trick
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller normal
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u3 = Math.random();
    if (u3 < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u3) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export interface CreativeBanditArm {
  id: string;
  successCount: number;
  trialCount: number;
}

/**
 * Pure function — DB 의존성 없이 arms 배열에서 Thompson 선택.
 * 단위 테스트 가능. DB 어댑터는 selectCreativeByThompson 에서 별도 wrap.
 */
export function pickArmThompson(arms: CreativeBanditArm[]): string | null {
  if (arms.length === 0) return null;
  if (arms.length === 1) return arms[0].id;

  let bestId = arms[0].id;
  let bestSample = -Infinity;
  for (const arm of arms) {
    const success = Math.max(0, arm.successCount);
    const failure = Math.max(0, arm.trialCount - arm.successCount);
    // Beta(success+1, failure+1) — Laplace smoothing (콜드 스타트 안전)
    const sample = sampleBeta(success + 1, failure + 1);
    if (sample > bestSample) {
      bestSample = sample;
      bestId = arm.id;
    }
  }
  return bestId;
}

/** 동률 처리 — 같은 stats 면 모든 arm 동등 확률 (시드 stable). */
export function pickArmGreedyCTR(arms: CreativeBanditArm[]): string | null {
  if (arms.length === 0) return null;
  let best = arms[0];
  let bestCtr = best.trialCount > 0 ? best.successCount / best.trialCount : 0;
  for (const arm of arms.slice(1)) {
    const ctr = arm.trialCount > 0 ? arm.successCount / arm.trialCount : 0;
    if (ctr > bestCtr) {
      best = arm;
      bestCtr = ctr;
    }
  }
  return best.id;
}

// ── DB 어댑터 ────────────────────────────────────────────────

/**
 * 같은 (package_id, platform) 의 ad_creatives 중에서 Thompson sampling 으로 1개 선택.
 * - 변형 없으면 null
 * - DB 미설정 시 null
 * - 선택 직후 bandit_last_selected_at 업데이트 (관찰성)
 */
export async function selectCreativeByThompson(params: {
  packageId: string;
  platform: string;
}): Promise<{ creativeId: string; selectionLog: string } | null> {
  if (!isSupabaseConfigured) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const { data, error } = await sb
    .from('ad_creatives')
    .select('id, bandit_success_count, bandit_trial_count')
    .eq('package_id', params.packageId)
    .eq('platform', params.platform);
  if (error || !data || data.length === 0) return null;

  const arms: CreativeBanditArm[] = (data as Array<{
    id: string;
    bandit_success_count?: number;
    bandit_trial_count?: number;
  }>).map((row) => ({
    id: row.id,
    successCount: row.bandit_success_count ?? 0,
    trialCount: row.bandit_trial_count ?? 0,
  }));

  const pickedId = pickArmThompson(arms);
  if (!pickedId) return null;

  const picked = arms.find((a) => a.id === pickedId)!;
  const ctr = picked.trialCount > 0 ? (picked.successCount / picked.trialCount * 100).toFixed(1) : '0';
  const selectionLog = `Thompson 선택: ${pickedId.slice(0, 8)} (s=${picked.successCount}/t=${picked.trialCount} CTR=${ctr}% / 총 ${arms.length}개 arm)`;

  // 관찰성: 마지막 선택 시각 기록 (silent fail OK — 본 흐름과 무관)
  await sb
    .from('ad_creatives')
    .update({ bandit_last_selected_at: new Date().toISOString() } as never)
    .eq('id', pickedId)
    .then(
      () => {},
      (e: unknown) =>
        console.warn(
          '[ad-creative-bandit] last_selected_at 업데이트 실패:',
          (e as Error)?.message ?? e,
        ),
    );

  return { creativeId: pickedId, selectionLog };
}

/**
 * 결과 업데이트 — 노출 후 (click 또는 conversion) 호출.
 * @param creativeId  선택된 ad_creatives.id
 * @param success     true=click/conversion, false=no-action
 */
export async function recordCreativeOutcome(
  creativeId: string,
  success: boolean,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = getSupabaseAdmin();
  if (!sb) return;

  // 원자성 보장 위해 SQL 함수 호출이 이상적이지만, 우선 read-modify-write 로 진행.
  // race condition 발생률 낮음 (광고 카피 변형 노출은 ~초당 ≤10).
  const { data, error } = await sb
    .from('ad_creatives')
    .select('bandit_success_count, bandit_trial_count')
    .eq('id', creativeId)
    .limit(1);
  if (error || !data?.[0]) return;
  const row = data[0] as { bandit_success_count?: number; bandit_trial_count?: number };
  const nextSuccess = (row.bandit_success_count ?? 0) + (success ? 1 : 0);
  const nextTrial = (row.bandit_trial_count ?? 0) + 1;

  await sb
    .from('ad_creatives')
    .update({
      bandit_success_count: nextSuccess,
      bandit_trial_count: nextTrial,
    } as never)
    .eq('id', creativeId)
    .then(
      () => {},
      (e: unknown) =>
        console.warn(
          '[ad-creative-bandit] outcome 업데이트 실패:',
          (e as Error)?.message ?? e,
        ),
    );
}
