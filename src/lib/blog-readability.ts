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

import { stripMarkup } from './blog-text-utils';

const DOUBLE_NEGATIVE_PATTERNS = [
  /없지\s*않[다았]/g,
  /아닐\s*수\s*없[다었]/g,
  /못\s*할\s*것\s*없[다었]/g,
  /안\s*하지\s*않/g,
];

export function computeReadability(blogHtml: string): ReadabilityResult {
  // 문장 분리에 '\n+' 를 사용하므로 줄바꿈을 보존해야 한다.
  const text = stripMarkup(blogHtml, { stripTablePipes: true, collapseWhitespace: false });
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
 * blog_type별 최적 가독성 구간
 */
const BLOG_TYPE_READABILITY_RANGES: Record<string, { min: number; max: number }> = {
  info: { min: 60, max: 80 },
  product: { min: 70, max: 90 },
  list: { min: 50, max: 70 },
};

export function getOptimalReadabilityRange(blogType: string): { min: number; max: number } {
  return BLOG_TYPE_READABILITY_RANGES[blogType] ?? { min: 60, max: 85 };
}

/**
 * 한국어 조사 목록 — 어절 분석용
 */
const KOREAN_PARTICLES = [
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과',
  '으로', '로', '에서', '부터', '까지', '도', '만', '처럼', '보다', '하고',
];

const FOREIGN_PATTERNS = [
  // 여행 관련 외래어
  /\b(package|tour|hotel|resort|booking|ticket|check\s*in|checkout|guide|course|pick\s*up|drop\s*off)\b/gi,
  // 숫자/단위
  /\b(\d+\s*(kg|m|cm|km|㎡|평|층|개|인|명|시|분|초))\b/gi,
];

/**
 * 외래어로 간주할 공통 단어 목록 (여행/숙박 컨텍스트)
 */
const FOREIGN_WORDS = new Set([
  '호텔', '리조트', '패키지', '투어', '가이드', '티켓', '예약',
  '캔슬', '환불', '옵션', '서비스', '이벤트', '프로모션', '할인',
  '쿠폰', '포인트', '멤버십', '로열티', '체크인', '체크아웃',
  '조식', '중식', '석식', '뷔페', '디너', '피크닉', '바비큐',
  '샤워실', '화장실', '라운지', '테라스', '발코니', '인피니티풀',
  '자쿠지', '사우나', '스파', '마사지', '피트니스', '짐',
  '레스토랑', '카페', '바', '라운지바', '룸서비스',
  '컨시어지', '벨보이', '도어맨', '프론트', '로비',
  '엘리베이터', '에스컬레이터', '계단', '주차장',
  '수영장', '테니스장', '골프장', '스키장',
  '렌터카', '택시', '셔틀', '리무진', '픽업', '드롭',
  '액티비티', '레저', '어드벤처', '트레킹', '하이킹', '래프팅',
  '다이빙', '스노클링', '서핑', '패러글라이딩', '번지점프',
  '쇼핑', '면세점', '마트', '편의점', '시장',
  '데이터', '로밍', '와이파이', '심카드', '유심',
  '환전', '송금', '카드', '현금', '수수료',
  '보험', '여행자보험', '비자', '여권', '면허증',
  '어플', '앱', '홈페이지', '사이트', '온라인',
  '템플스테이', '한옥스테이', '게스트하우스', '민박',
  '펜션', '콘도', '빌라', '아파트', '오피스텔',
  '스튜디오', '복층', '펜트하우스', '스위트룸',
  '노쇼', '얼리체크인', '레이트체크아웃',
  '마일리지', '적립', '사은품', '증정', '이벤트',
  '커플', '가족', '단체', '솔로', '혼자',
  '인스타', '인스타그램', '셀카', '인증샷',
  '플렉스', '가심비', '스펙', '컨디션',
  '시그니처', '베스트', '추천', '필수', '꿀팁',
  '모바일', '디지털', '테크', 'IT',
  '프리미엄', '스탠다드', '디럭스', '슈페리어',
]);

/**
 * 한글 문장에서 조사 목록 추출
 */
function extractParticles(text: string): string[] {
  const particles: string[] = [];
  // 공백 기준 어절 분리 후 마지막 1-2글자 확인
  const words = text.split(/\s+/);
  for (const word of words) {
    for (const p of KOREAN_PARTICLES) {
      if (word.endsWith(p) && word.length > 1) {
        particles.push(p);
        break;
      }
    }
  }
  return particles;
}

/**
 * 조사 다양성 계산 (0~1)
 */
function calcParticleDiversity(text: string): number {
  const particles = extractParticles(text);
  if (particles.length === 0) return 1;
  const unique = new Set(particles);
  return unique.size / particles.length;
}

/**
 * 어절당 평균 글자 수 (eojeol complexity)
 */
function calcAvgEojeolLen(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const totalCharLen = words.reduce((a, w) => a + w.length, 0);
  return +(totalCharLen / words.length).toFixed(1);
}

/**
 * 외래어 밀도 (0~1)
 */
function calcForeignWordDensity(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let foreignCount = 0;
  for (const w of words) {
    // 순수 한글만으로 구성되지 않은 단어
    const pureHangul = /^[가-힣]+$/.test(w);
    if (!pureHangul) {
      foreignCount++;
      continue;
    }
    // FOREIGN_WORDS 셋에 포함된 단어
    if (FOREIGN_WORDS.has(w)) {
      foreignCount++;
    }
  }
  return +(foreignCount / words.length).toFixed(3);
}

/**
 * 문장 길이가 40자 이상인 (긴 문장) 비율 계산
 */
function detectLongSentences(text: string): string[] {
  const sentences = text
    .split(/[.!?。！？]\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 5);

  return sentences.filter(s => s.length >= 40);
}

/**
 * 연속된 조사 반복 패턴 감지 (은/는/이/가 연속)
 */
function detectRepeatedParticles(text: string): string[] {
  const issues: string[] = [];
  const sentences = text
    .split(/[.!?。！？]\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 5);

  for (const sentence of sentences) {
    const particles = extractParticles(sentence);
    // 3개 이상 연속으로 같은 조사가 쓰였는지 확인
    const consecutiveCounts: Record<string, number> = {};
    for (const p of particles) {
      consecutiveCounts[p] = (consecutiveCounts[p] ?? 0) + 1;
    }
    for (const [p, cnt] of Object.entries(consecutiveCounts)) {
      const ratio = cnt / particles.length;
      if (cnt >= 3 && ratio > 0.4) {
        issues.push(`"${sentence.substring(0, 40)}…"에서 조사 "${p}" ${cnt}회 중복`);
        break;
      }
    }
  }
  return issues.slice(0, 3);
}

/**
 * suggestReadabilityFix — 긴 문장 분할, 조사 반복 정리, 외래어 밀도 경고
 *
 * @param html    - 원본 HTML 본문
 * @param blogType - 블로그 타입 (info/product/list)
 * @returns 수정 제안 HTML (또는 원본을 건드리지 않고 제안 문자열 목록 반환)
 *
 * 현재는 Suggest 형식으로 제안 문자열 배열을 반환하도록 설계.
 * 추후 자동 교체 기능 확장 가능.
 */
export function suggestReadabilityFix(html: string, blogType: string = 'info'): string[] {
  const suggestions: string[] = [];
  const text = stripMarkup(html, { stripTablePipes: true, collapseWhitespace: false });

  const optimalRange = getOptimalReadabilityRange(blogType);

  // 1) 너무 긴 문장 감지 (40자 이상)
  const longSentences = detectLongSentences(text);
  if (longSentences.length > 0) {
    const pct = +((longSentences.length / Math.max(1, text.split(/[.!?]/).length)) * 100).toFixed(0);
    if (pct > 30) {
      suggestions.push(
        `긴 문장 비율 ${pct}%: ${longSentences.length}개 문장이 40자 이상입니다. 쉼표나 마침표로 분할하세요.`,
      );
    }
  }

  // 2) 조사 반복 패턴
  const particleIssues = detectRepeatedParticles(text);
  for (const issue of particleIssues) {
    suggestions.push(`조사 반복: ${issue}. 문장 구조를 다양화하세요.`);
  }

  // 3) 외래어 밀도
  const foreignDensity = calcForeignWordDensity(text);
  if (foreignDensity > 0.3) {
    suggestions.push(
      `외래어 밀도 ${(foreignDensity * 100).toFixed(0)}%: 외래어 사용을 줄이고 순화어로 대체하세요.`,
    );
  }

  // 4) 가독성 점수 기반 제안
  const readability = computeReadability(html);
  if (readability.score < optimalRange.min) {
    suggestions.push(
      `<strong>가독성 ${readability.score}점</strong> (${blogType} 권장 ${optimalRange.min}-${optimalRange.max}). ${readability.issues.slice(0, 2).join('. ')}`,
    );
  }

  return suggestions;
}

/**
 * blog-quality-gate 와 같은 인터페이스 — 게이트로 사용
 */
export function checkReadability(blogHtml: string, minScore?: number, blogType?: string): {
  gate: 'readability';
  passed: boolean;
  reason?: string;
  evidence?: Record<string, unknown>;
} {
  const r = computeReadability(blogHtml);
  const optimalRange = blogType
    ? getOptimalReadabilityRange(blogType)
    : { min: minScore ?? 0, max: 100 };
  const threshold = minScore ?? optimalRange.min;
  return {
    gate: 'readability',
    passed: r.score >= threshold,
    reason: r.score < threshold
      ? `가독성 ${r.score}/100 (최소 ${threshold}점). ${r.issues.slice(0, 2).join(' · ')}`
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
