/**
 * Bayesian A/B 테스트 — Thompson Sampling (Beta 분포)
 *
 * Chi-square 대신 Bayesian을 쓰는 이유:
 *   - Chi-square는 최소 30+ 샘플 필요 → 한국 여행사 카드뉴스는 24h 좋아요 5~20개
 *   - Thompson Sampling은 소샘플에서도 작동, Prior가 약하게 정보 주입
 *
 * 성공 지표:
 *   successes = likes×1 + saves×2 + shares×3
 *   trials    = reach (도달 수)
 *   failures  = max(0, trials - successes)
 *
 * 결정 기준: prob_best >= 0.95 (95% 확률로 이 변형이 최선)
 */

interface Variant {
  id: string;
  successes: number; // 가중 engagement
  trials: number;    // reach
}

interface ProbabilityResult {
  variantId: string;
  probBest: number;
}

/**
 * Beta(α, β) 분포에서 샘플링 (Gamma 함수 기반, jStat 불필요).
 *
 * Gamma(k, 1) → GKM-1 방법 (k < 1 일 때 Johnk, k >= 1 일 때 Marsaglia-Tsang)
 */
function sampleBeta(alpha: number, beta: number): number {
  const ga = sampleGamma(alpha);
  const gb = sampleGamma(beta);
  const sum = ga + gb;
  return sum === 0 ? 0.5 : ga / sum;
}

function sampleGamma(shape: number): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    // Johnk's method for shape < 1
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  // Marsaglia-Tsang method for shape >= 1
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleNormal(): number {
  // Box-Muller transform
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Thompson Sampling: 각 변형의 "최선일 확률" 계산 (Monte Carlo 10,000회).
 */
export function calculateProbabilityOfBest(
  variants: Variant[],
  simulations = 10_000,
): ProbabilityResult[] {
  if (variants.length === 0) return [];
  if (variants.length === 1) return [{ variantId: variants[0].id, probBest: 1 }];

  const counts = new Map<string, number>(variants.map((v) => [v.id, 0]));

  for (let i = 0; i < simulations; i++) {
    let bestSample = -1;
    let bestId = '';

    for (const v of variants) {
      const failures = Math.max(0, v.trials - v.successes);
      // Prior: Beta(1, 1) = Uniform. Posterior: Beta(successes+1, failures+1)
      const s = sampleBeta(v.successes + 1, failures + 1);
      if (s > bestSample) {
        bestSample = s;
        bestId = v.id;
      }
    }

    counts.set(bestId, (counts.get(bestId) ?? 0) + 1);
  }

  return variants.map((v) => ({
    variantId: v.id,
    probBest: (counts.get(v.id) ?? 0) / simulations,
  }));
}

/**
 * post_engagement_snapshots 행 → Variant 변환 헬퍼.
 * winner-detector.ts 와 동일한 가중치 체계 사용.
 */
export function snapshotToVariant(input: {
  id: string;
  engagement_raw: {
    likes?: number;
    saves?: number;
    shares?: number;
    reach?: number;
  } | null;
}): Variant {
  const m = input.engagement_raw;
  const successes =
    (m?.likes ?? 0) * 1 +
    (m?.saves ?? 0) * 2 +
    (m?.shares ?? 0) * 3;
  const trials = Math.max(successes, m?.reach ?? 0);
  return { id: input.id, successes, trials };
}

/**
 * 변형 목록에서 Bayesian winner 선택.
 * - prob_best >= 0.95 → decided
 * - prob_best < 0.95  → 데이터 더 필요
 */
export function selectBayesianWinner(variants: Variant[]): {
  winnerId: string | null;
  decided: boolean;
  probabilities: ProbabilityResult[];
  reason: string;
} {
  if (variants.length < 2) {
    return {
      winnerId: null,
      decided: false,
      probabilities: [],
      reason: `변형 ${variants.length}개 — 최소 2개 필요`,
    };
  }

  const probs = calculateProbabilityOfBest(variants);
  const best = probs.reduce((a, b) => (a.probBest > b.probBest ? a : b));

  if (best.probBest >= 0.95) {
    return {
      winnerId: best.variantId,
      decided: true,
      probabilities: probs,
      reason: `Bayesian winner: prob_best = ${(best.probBest * 100).toFixed(1)}% >= 95%`,
    };
  }

  return {
    winnerId: null,
    decided: false,
    probabilities: probs,
    reason: `prob_best = ${(best.probBest * 100).toFixed(1)}% < 95%, 데이터 더 필요`,
  };
}
