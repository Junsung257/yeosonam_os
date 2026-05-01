/**
 * TOPSIS (Hwang & Yoon 1981) — Technique for Order of Preference by Similarity to Ideal Solution
 *
 * 1. Vector normalization (column-wise)
 * 2. Weighted normalization (× weights)
 * 3. Ideal solution = max of benefit cols / min of cost cols
 *    Anti-ideal = opposite
 * 4. Euclidean distances D⁺ (to ideal), D⁻ (to anti-ideal)
 * 5. Score = D⁻ / (D⁺ + D⁻) ∈ [0, 1]
 *
 * 순수 함수. 외부 의존성 없음. 단위 테스트 가능.
 */

export type CriterionType = 'benefit' | 'cost';

export interface TopsisInput {
  matrix: number[][];      // [N alternatives][M criteria]
  weights: number[];       // [M], 합=1 권장 (정규화 안 함, 호출자 책임)
  types: CriterionType[];  // [M]
}

export interface TopsisOutput {
  scores: number[];        // [N], 0~1 (높을수록 우수)
  ranks: number[];         // [N], 1-based (1=최고)
}

export function topsis({ matrix, weights, types }: TopsisInput): TopsisOutput {
  const n = matrix.length;
  if (n === 0) return { scores: [], ranks: [] };
  const m = matrix[0]?.length ?? 0;
  if (m === 0) return { scores: matrix.map(() => 0.5), ranks: matrix.map((_, i) => i + 1) };

  if (weights.length !== m || types.length !== m) {
    throw new Error(`TOPSIS dim mismatch: cols=${m} weights=${weights.length} types=${types.length}`);
  }
  for (const row of matrix) {
    if (row.length !== m) throw new Error('TOPSIS: ragged matrix');
    for (const v of row) if (!Number.isFinite(v)) throw new Error('TOPSIS: non-finite value');
  }

  // 1) Vector normalization
  const colNorms = new Array<number>(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += matrix[i][j] ** 2;
    colNorms[j] = Math.sqrt(s) || 1; // div-by-zero 방어
  }
  const normalized = matrix.map(row => row.map((v, j) => v / colNorms[j]));

  // 2) Weighted
  const weighted = normalized.map(row => row.map((v, j) => v * weights[j]));

  // 3) Ideal & anti-ideal
  const ideal = new Array<number>(m);
  const anti = new Array<number>(m);
  for (let j = 0; j < m; j++) {
    let mx = -Infinity, mn = Infinity;
    for (let i = 0; i < n; i++) {
      const v = weighted[i][j];
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    if (types[j] === 'benefit') { ideal[j] = mx; anti[j] = mn; }
    else { ideal[j] = mn; anti[j] = mx; }
  }

  // 4) Distances
  const dPlus = new Array<number>(n);
  const dMinus = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sp = 0, sm = 0;
    for (let j = 0; j < m; j++) {
      sp += (weighted[i][j] - ideal[j]) ** 2;
      sm += (weighted[i][j] - anti[j]) ** 2;
    }
    dPlus[i] = Math.sqrt(sp);
    dMinus[i] = Math.sqrt(sm);
  }

  // 5) Score
  const scores = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const sum = dPlus[i] + dMinus[i];
    scores[i] = sum === 0 ? 0.5 : dMinus[i] / sum;
  }

  // Ranks (descending)
  const order = scores.map((s, i) => ({ s, i }));
  order.sort((a, b) => b.s - a.s);
  const ranks = new Array<number>(n);
  order.forEach((o, idx) => { ranks[o.i] = idx + 1; });

  return { scores, ranks };
}

/**
 * Entropy weighting — Shannon entropy로 객관 가중치 산출
 * BWM(주관) × Entropy(객관)을 곱셈 결합할 때 객관 측 입력
 */
export function entropyWeights(matrix: number[][], types: CriterionType[]): number[] {
  const n = matrix.length;
  if (n === 0) return [];
  const m = matrix[0].length;
  if (m === 0) return [];

  // cost criterion 은 부호 반전 (entropy 입력은 benefit 형태)
  const adjusted = matrix.map(row =>
    row.map((v, j) => types[j] === 'cost' ? 1 / (v + 1e-9) : v)
  );

  const colSums = new Array<number>(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) colSums[j] += adjusted[i][j];
    if (colSums[j] === 0) colSums[j] = 1;
  }
  const p = adjusted.map(row => row.map((v, j) => v / colSums[j]));

  const k = 1 / Math.log(n || 2);
  const e = new Array<number>(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const pij = p[i][j];
      if (pij > 0) s += pij * Math.log(pij);
    }
    e[j] = -k * s;
  }

  const d = e.map(v => 1 - v);
  const dSum = d.reduce((a, b) => a + b, 0) || 1;
  return d.map(v => v / dSum);
}

/**
 * BWM × Entropy 곱셈 결합 → 정규화
 */
export function combineBwmEntropy(bwm: number[], entropy: number[]): number[] {
  if (bwm.length !== entropy.length) throw new Error('BWM/Entropy length mismatch');
  const product = bwm.map((b, i) => b * entropy[i]);
  const sum = product.reduce((a, b) => a + b, 0) || 1;
  return product.map(v => v / sum);
}
