/**
 * @file hangul-fuzzy.ts — 한글 자모 분리 + Levenshtein 거리 기반 attraction 매칭 (2026-05-14 박제)
 *
 * 박제 사유:
 *   "루브르박물관" ↔ "루브로박물관" ↔ "루불르박물관" 같은 음역 변형이 attraction-matcher 의
 *   exact / alias / substring / keyword split 단계 어디에도 잡히지 않아 unmatched_activities 큐로
 *   빠지던 사고 차단. 한글 자모 분리 후 Levenshtein 거리 ≤ 2 매칭으로 음역 변형 자동 흡수.
 *
 * 학계: Damerau-Levenshtein 의 변형으로, 음역 변형(ㅡ↔ㅜ, ㅗ↔ㅜ, ㅏ↔ㅓ) 은
 * Jamo 단위에서 거리 1 로 측정되어 정확. 한글 한 글자 음절 단위 비교(거리 1=한 글자 통째 차이)
 * 보다 훨씬 더 미세한 변형 감지 가능.
 *
 * 보안: matcher 와 같은 destination scope 안에서만 사용 — fuzzy 가 전 세계 attraction 으로
 * 풀리면 "맥주거리→삿포로 맥주박물관" 같은 사고 재발. 호출 측에서 후보 filter 강제.
 */

// 한글 음절 → 자모 분리 (Choseong + Jungseong + Jongseong)
// 음절 코드 = 0xAC00 + ((cho * 21) + jung) * 28 + jong
const HANGUL_BASE = 0xAC00;
const HANGUL_END = 0xD7A3;
const CHO_CYCLE = 21 * 28;
const JUNG_CYCLE = 28;

/** 한 음절을 [초성, 중성, 종성] 코드포인트(자모) 배열로 분리. 종성 없으면 2개 반환. */
function syllableToJamo(code: number): number[] {
  if (code < HANGUL_BASE || code > HANGUL_END) return [code];
  const offset = code - HANGUL_BASE;
  const cho = Math.floor(offset / CHO_CYCLE);
  const jung = Math.floor((offset % CHO_CYCLE) / JUNG_CYCLE);
  const jong = offset % JUNG_CYCLE;
  // 자모 코드포인트: 초성 0x1100-0x1112, 중성 0x1161-0x1175, 종성 0x11A7-0x11C2
  const out = [0x1100 + cho, 0x1161 + jung];
  if (jong > 0) out.push(0x11A7 + jong);
  return out;
}

/** 문자열 → 자모 분리 + 정규화 (공백/괄호/구두점 제거, lowercase). */
export function toJamoNormalized(s: string): number[] {
  // 공백·괄호·· 같은 노이즈 제거. 비한글은 lowercase 후 그대로.
  const cleaned = s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]『』「」「」·•・,，.。·:：;；'"′″`!?]/g, '');
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      out.push(...syllableToJamo(code));
    } else {
      out.push(code);
    }
  }
  return out;
}

/**
 * 비슷한 자모 그룹화 (음역 변형 흡수).
 *   - ㅡ(0x1173) / ㅜ(0x116E) — "루브르 vs 루부르"
 *   - ㅓ(0x1165) / ㅏ(0x1161) — "터미널 vs 타미널"
 *   - ㅗ(0x1169) / ㅜ(0x116E) — "도쿄 vs 두쿄" (자주는 아니지만)
 *   - ㄹ(0x1105) / ㄴ(0x1102) — 받침에서만 (드물지만 외래어 표기 변형)
 *
 * 같은 그룹 자모는 거리 0.5 로 계산 (완전 일치 = 0, 다른 그룹 = 1).
 */
const JAMO_NEIGHBORS: Record<number, number[]> = {
  0x1173: [0x116E],            // ㅡ ↔ ㅜ
  0x116E: [0x1173, 0x1169],    // ㅜ ↔ ㅡ, ㅗ
  0x1169: [0x116E],            // ㅗ ↔ ㅜ
  0x1165: [0x1161],            // ㅓ ↔ ㅏ
  0x1161: [0x1165],            // ㅏ ↔ ㅓ
};

function jamoDistance(a: number, b: number): number {
  if (a === b) return 0;
  const neighbors = JAMO_NEIGHBORS[a];
  if (neighbors && neighbors.includes(b)) return 0.5;
  return 1;
}

/**
 * 자모 시퀀스 간 Levenshtein 거리.
 * 비슷한 자모는 0.5 거리로 가중 — "루브르(0x1105 0x116E 0x1107 0x1173 0x1105 0x1173)" vs
 * "루부르(0x1105 0x116E 0x1107 0x116E 0x1105 0x1173)" → 차이 1자모(ㅡ→ㅜ) → 거리 0.5.
 */
export function jamoLevenshtein(a: number[], b: number[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  // 1차원 DP (메모리 절약)
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + jamoDistance(a[i - 1], b[j - 1]);
      const ins = curr[j - 1] + 1;
      const del = prev[j] + 1;
      curr[j] = Math.min(sub, ins, del);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * 두 문자열의 한글 자모 기반 유사도. 0.0(완전 다름) ~ 1.0(완전 일치).
 * 비슷한 자모는 0.5 가중치라 "루브르 vs 루부르" 가 distance 0.5 → similarity ≈ 0.92.
 */
export function hangulSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ja = toJamoNormalized(a);
  const jb = toJamoNormalized(b);
  if (ja.length === 0 || jb.length === 0) return 0;
  const dist = jamoLevenshtein(ja, jb);
  const maxLen = Math.max(ja.length, jb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Fuzzy match: query 가 후보 중 하나와 충분히 비슷하면 best match 반환.
 *   - threshold: 기본 0.82 (자모 1~2개 차이까지 흡수, 단어 길이 6~12 기준)
 *   - 후보 길이 차이가 너무 크면 (>50%) 자동 제외 (성능 + 정확도)
 */
export interface FuzzyMatchResult<T> {
  candidate: T;
  score: number;
}

export function bestFuzzyMatch<T>(
  query: string,
  candidates: T[],
  getName: (c: T) => string,
  threshold = 0.82,
): FuzzyMatchResult<T> | null {
  if (!query || candidates.length === 0) return null;
  const queryJamo = toJamoNormalized(query);
  if (queryJamo.length < 4) return null; // 너무 짧으면 false positive 위험

  let best: FuzzyMatchResult<T> | null = null;
  for (const c of candidates) {
    const name = getName(c);
    if (!name) continue;
    const nameJamo = toJamoNormalized(name);
    if (nameJamo.length === 0) continue;
    // 길이 차이 50% 초과면 skip (성능)
    const lenRatio = Math.min(queryJamo.length, nameJamo.length) / Math.max(queryJamo.length, nameJamo.length);
    if (lenRatio < 0.5) continue;
    const dist = jamoLevenshtein(queryJamo, nameJamo);
    const maxLen = Math.max(queryJamo.length, nameJamo.length);
    const score = Math.max(0, 1 - dist / maxLen);
    if (score >= threshold && (!best || score > best.score)) {
      best = { candidate: c, score };
    }
  }
  return best;
}
