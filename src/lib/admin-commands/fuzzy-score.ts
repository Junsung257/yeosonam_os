/**
 * Fuzzy match score — cmdk 의 command-score 와 유사한 단순 알고리즘.
 *
 *  - 0   : 매칭 없음
 *  - 0~1 : 점수 (높을수록 좋음)
 *
 * 규칙:
 *  - 정확 일치(equal)        : 1.0
 *  - prefix 일치             : 0.9
 *  - 단어 경계 시작           : 0.8
 *  - substring 포함           : 0.6
 *  - 문자 순서대로 흩어진 매칭 : 0.3 ~ 0.5 (간격에 비례 감점)
 *
 * 한글/영문 모두 lower-case 정규화 후 비교.
 */

export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0.5; // 빈 쿼리는 모든 항목 동일 노출
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0.5;

  if (t === q) return 1.0;
  if (t.startsWith(q)) return 0.9;

  // 단어 경계 시작 (공백/슬래시/언더스코어/하이픈 뒤)
  const wordBoundary = new RegExp(`(^|[\\s/_\\-])${escapeRegex(q)}`, 'i');
  if (wordBoundary.test(text)) return 0.8;

  if (t.includes(q)) return 0.6;

  // 흩어진 매칭 — 쿼리 글자가 순서대로 모두 등장하면 점수
  let ti = 0;
  let lastMatch = -1;
  let totalGap = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    if (lastMatch !== -1) totalGap += found - lastMatch - 1;
    lastMatch = found;
    ti = found + 1;
  }
  // 간격이 클수록 감점
  const span = lastMatch - (q.length === 0 ? 0 : 0);
  const gapPenalty = Math.min(0.2, totalGap / Math.max(1, t.length));
  return Math.max(0.2, 0.5 - gapPenalty - span / Math.max(1, t.length * 4));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 여러 필드 중 최대 점수
 */
export function maxFuzzyScore(query: string, fields: (string | undefined | null)[]): number {
  let max = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = fuzzyScore(f, query);
    if (s > max) max = s;
  }
  return max;
}
