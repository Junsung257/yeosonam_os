/**
 * Korean Readability Score — 한국어 본문 가독성 측정 (0~100)
 *
 * Why: Flesch는 영어 음절 기반이라 한국어에 부적합.
 *      한국어는 어절수 + 문장 길이 + 이중부정/도배 패턴이 핵심 휴리스틱.
 *
 * 점수 산정:
 *   100점 = 매우 읽기 쉬움 (블로그 평균 어절 2-3, 문장 30자)
 *   60-79  = 보통
 *   <60    = 어려움 (장문장 다수, 이중부정 도배)
 *
 * 감점 요소:
 *   - 평균 문장 길이 60자 이상 → 감점
 *   - 단일 문장 100자 이상 → 강한 감점
 *   - 이중부정 ("...없지 않다", "...아닐 수 없다") → 감점
 *   - 같은 어절 5회 이상 도배 → 감점
 *   - 한자/영어 비율 25% 이상 → 약한 감점
 */

export interface ReadabilityResult {
  score: number;
  sentence_count: number;
  avg_sentence_len: number;
  long_sentence_count: number;
  double_negative_count: number;
  duplicate_phrases: Array<{ phrase: string; count: number }>;
  issues: string[];
}

const DOUBLE_NEGATIVE_PATTERNS = [
  /없지\s*않[다았]/g,
  /아닐\s*수\s*없[다었]/g,
  /못\s*할\s*것\s*없[다었]/g,
  /안\s*하지\s*않/g,
];

function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/#{1,6}\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\|/g, ' ')
    .trim();
}

export function computeReadability(blogHtml: string): ReadabilityResult {
  const text = stripMarkup(blogHtml);
  const issues: string[] = [];

  if (text.length < 100) {
    return {
      score: 0,
      sentence_count: 0,
      avg_sentence_len: 0,
      long_sentence_count: 0,
      double_negative_count: 0,
      duplicate_phrases: [],
      issues: ['본문 너무 짧음 (100자 미만)'],
    };
  }

  // 1) 문장 분리 — 마침표/물음표/느낌표 OR 줄바꿈 (마크다운 목록/단락 분리)
  const sentences = text
    .split(/[.!?。！？]\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 5);

  const sentenceCount = sentences.length;
  if (sentenceCount === 0) {
    return {
      score: 30,
      sentence_count: 0,
      avg_sentence_len: 0,
      long_sentence_count: 0,
      double_negative_count: 0,
      duplicate_phrases: [],
      issues: ['문장 구분 불가 — 마침표 부족'],
    };
  }

  const totalLen = sentences.reduce((a, s) => a + s.length, 0);
  const avgLen = +(totalLen / sentenceCount).toFixed(1);

  // 2) 장문장 — 100자 이상
  const longSentences = sentences.filter(s => s.length >= 100);
  const longRatio = longSentences.length / sentenceCount;

  // 3) 이중부정
  let doubleNegCount = 0;
  for (const re of DOUBLE_NEGATIVE_PATTERNS) {
    const matches = text.match(re);
    if (matches) doubleNegCount += matches.length;
  }

  // 4) 도배 어절 (5어절 이상 같은 표현이 5회 이상)
  const phrases = new Map<string, number>();
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length - 4; i++) {
    const phrase = tokens.slice(i, i + 5).join(' ');
    if (phrase.length < 10) continue;
    phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
  }
  const duplicates = Array.from(phrases.entries())
    .filter(([_, cnt]) => cnt >= 5)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 5) 점수 계산 (100 시작, 감점)
  let score = 100;

  if (avgLen > 60) {
    score -= Math.min(20, (avgLen - 60) * 0.5);
    issues.push(`평균 문장 길이 ${avgLen}자 (권장 30~50자)`);
  }
  if (longRatio > 0.15) {
    score -= Math.min(15, longRatio * 100);
    issues.push(`장문장(100자+) ${longSentences.length}개 — ${(longRatio * 100).toFixed(0)}%`);
  }
  if (doubleNegCount > 2) {
    score -= Math.min(15, doubleNegCount * 3);
    issues.push(`이중부정 ${doubleNegCount}회 — 직접 단언 권장`);
  }
  if (duplicates.length > 0) {
    score -= Math.min(20, duplicates[0].count * 2);
    issues.push(`도배 어절: "${duplicates[0].phrase.slice(0, 30)}…" ${duplicates[0].count}회`);
  }

  // 한자/영어 비율
  const totalChars = text.length;
  const cjkChars = (text.match(/[一-鿿]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  const foreignRatio = (cjkChars + enChars) / totalChars;
  if (foreignRatio > 0.25) {
    score -= Math.min(10, (foreignRatio - 0.25) * 40);
    issues.push(`한자/영어 비율 ${(foreignRatio * 100).toFixed(0)}% — 한글 우선`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    sentence_count: sentenceCount,
    avg_sentence_len: avgLen,
    long_sentence_count: longSentences.length,
    double_negative_count: doubleNegCount,
    duplicate_phrases: duplicates,
    issues,
  };
}

/**
 * blog-quality-gate 와 같은 인터페이스 — 게이트로 사용
 */
export function checkReadability(blogHtml: string, minScore: number = 60): {
  gate: 'readability';
  passed: boolean;
  reason?: string;
  evidence?: Record<string, unknown>;
} {
  const r = computeReadability(blogHtml);
  return {
    gate: 'readability',
    passed: r.score >= minScore,
    reason: r.score < minScore
      ? `가독성 ${r.score}/100 (최소 ${minScore}점). ${r.issues.slice(0, 2).join(' · ')}`
      : undefined,
    evidence: {
      score: r.score,
      avg_sentence_len: r.avg_sentence_len,
      long_sentence_count: r.long_sentence_count,
      double_negative_count: r.double_negative_count,
      duplicate_phrases: r.duplicate_phrases,
    },
  };
}
