/**
 * Threads Trend Learner — 트렌드 기반 스타일 학습 파이프라인
 *
 * 출처: agent-style-transfer (GitHub ⭐) 의 Writing Style Inference 개념 차용
 *   + stylometric-transfer (GitHub ⭐) 의 statistical measurement 방식
 *
 * 흐름:
 *   1. Threads keyword_search API로 핫글 수집 (기존 threads-trend-miner 활용)
 *   2. 수집된 글에서 stylometric 특징 추출 (문장 길이, 감정 표현, 후크 패턴 등)
 *   3. 추출된 스타일 정보를 TrendSignal로 저장
 *   4. 상위 성과 글은 voice_samples에 append (기존 brand-voice 시스템과 연결)
 *   5. 주간/일일 리포트 생성 → 어떤 스타일이 현재 트렌드인지 피드백
 */

import { searchMultipleKeywords } from '@/lib/threads-search';
import { appendVoiceSample } from '@/lib/content-pipeline/brand-voice';
import type { TrendSignal } from '@/lib/trend-style-engine';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface TrendLearningResult {
  ok: boolean;
  signals: TrendSignal[];
  dominantKeywords: string[];
  styleSummary: string;
  errors: string[];
}

// ─── 여행 관련 트렌드 키워드 ──────────────────────────────────────────────
const TRAVEL_TREND_KEYWORDS = [
  '여행', '해외여행', '여행추천', '가성비여행', '혼자여행',
  '여행꿀팁', '항공권', '호캉스', '감성여행', '여행준비',
  '신혼여행', '배낭여행', '액티비티', '맛집투어', '힐링여행',
];

// ─── 감정/스타일 분석 어휘 ────────────────────────────────────────────────
const EMOTIONAL_MARKERS = [
  '진짜', '완전', '대박', '최고', '최악', '사랑', '행복',
  '감동', '힐링', '그리다', '아쉽', '후회', '설렌다', '벅차다', '여유',
];

const HOOK_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(.+?) (알\w+|가\w+)\?/, type: 'question' },
  { pattern: /저 (사실|진짜|최근)/, type: 'personal_confession' },
  { pattern: /(.+?)(알고\s*계|들어\w+\s*봤)/, type: 'curiosity_gap' },
  { pattern: /(.+?) (안\w+면\s+후회|꼭\s+가\w+)/, type: 'bold_statement' },
  { pattern: /\d+[가지개편]/ , type: 'numbers' },
  { pattern: /(.+?)(고민|걱정|어떻게)/, type: 'empathy' },
  { pattern: /(.+?)(아닌|말고|대신)/, type: 'redefinition' },
  { pattern: /(.+?)\.\s*(.+?)\.\s*(.+?[\.!])/, type: 'staccato' },
];

// ─── 메인 함수 ────────────────────────────────────────────────────────────────

/**
 * Threads 트렌드 학습 실행.
 * 기존 threads-trend-miner가 수집한 데이터를 추가로 분석해 스타일 시그널 추출.
 *
 * @param customKeywords 특정 키워드 집중 분석 (기본값: TRAVEL_TREND_KEYWORDS)
 * @returns 학습 결과 (TrendSignal 배열 + 요약)
 */
export async function learnThreadsTrends(
  customKeywords?: string[],
): Promise<TrendLearningResult> {
  const errors: string[] = [];
  const signals: TrendSignal[] = [];
  const results: TrendLearningResult = {
    ok: false,
    signals: [],
    dominantKeywords: [],
    styleSummary: '',
    errors,
  };

  const keywords = customKeywords ?? TRAVEL_TREND_KEYWORDS;

  // 1. Threads 키워드 검색 (TOP 모드 = engagement 정렬)
  const searchResults = await searchMultipleKeywords(keywords, 'TOP', 400);

  // 2. 각 결과에서 스타일 시그널 추출
  for (const { keyword, result } of searchResults) {
    if (!result.ok || result.posts.length === 0) continue;

    // engagement 점수 계산 (like + reply + repost)
    const scoredPosts = result.posts.map(post => {
      const engagement =
        (post.like_count ?? 0) +
        (post.reply_count ?? 0) +
        (post.repost_count ?? 0);
      return { post, engagement };
    }).sort((a, b) => b.engagement - a.engagement);

    // 상위 3개 글에서 스타일 분석
    const topPosts = scoredPosts.slice(0, 3);
    for (const { post, engagement } of topPosts) {
      if (!post.text || post.text.length < 20) continue;

      const styleSignal = extractStyleSignal(post.text);

      signals.push({
        keyword,
        platform: 'threads',
        observed_style: styleSignal,
        score: engagement,
        captured_at: post.timestamp ?? new Date().toISOString(),
      });
    }
  }

  if (signals.length === 0) {
    errors.push('수집된 트렌드 데이터 없음');
    return results;
  }

  // 3. dominant keywords 추출 (가장 활발한 키워드)
  const keywordScores = new Map<string, number>();
  for (const s of signals) {
    keywordScores.set(s.keyword, (keywordScores.get(s.keyword) ?? 0) + s.score);
  }
  const sortedKeywords = [...keywordScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  // 4. 스타일 요약 생성
  const styleSummary = generateStyleSummary(signals, sortedKeywords);

  // 5. 성과 상위 글 voice_samples에 append (brand-voice 학습 루프)
  // 병렬 처리: fire-and-forget보다 안전하게 allSettled
  const topSignals = [...signals].sort((a, b) => b.score - a.score).slice(0, 5);
  await Promise.allSettled(
    topSignals.map(async (s) => {
      if (!s.observed_style) return;
      return appendVoiceSample('yeosonam', {
        platform: 'threads',
        content: `${s.observed_style.hook_patterns.join(', ')} 스타일 | 키워드: ${s.keyword} | score: ${s.score}`,
        performance_score: Math.min(Math.round(s.score / 10), 100),
        captured_at: s.captured_at,
      });
    }),
  );

  results.ok = true;
  results.signals = signals;
  results.dominantKeywords = sortedKeywords;
  results.styleSummary = styleSummary;

  return results;
}

// ─── 스타일 시그널 추출 ─────────────────────────────────────────────────────

/**
 * 단일 Threads 포스트에서 stylometric 특징 추출.
 * stylometric-transfer 의 measurements 함수 역할.
 */
function extractStyleSignal(text: string): {
  avg_sentence_length: number;
  formality_estimate: number;
  emotional_estimate: number;
  emoji_density: number;
  hook_patterns: string[];
} {
  // 문장 분할 (한국어)
  const sentences = text
    .split(/[.!?]\s*/)
    .filter(s => s.trim().length > 1);

  // 평균 문장 길이
  const avgSentenceLength = sentences.length > 0
    ? Math.round(sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length)
    : 30;

  // 감정 표현 밀도
  const emotionalWordCount = EMOTIONAL_MARKERS.filter(w => text.includes(w)).length;
  const emotionalEstimate = Math.min(emotionalWordCount / Math.max(text.length / 100, 1), 1);

  // 이모지 밀도
  const emojiCount = (text.match(/[\p{Emoji}]/gu) ?? []).length;
  const emojiDensity = Math.min(emojiCount / Math.max(text.length / 100, 1), 1);

  // 격식 추정 (감정 표현 적고 문장 길면 격식 있음)
  const formalityEstimate = clamp(
    1 - emotionalEstimate * 0.6 - emojiDensity * 0.4,
    0, 1
  );

  // 후크 패턴 감지
  const firstLine = text.split('\n')[0] ?? text.slice(0, 100);
  const hookPatterns: string[] = [];
  for (const { pattern, type } of HOOK_PATTERNS) {
    if (pattern.test(firstLine) || pattern.test(text.slice(0, 150))) {
      hookPatterns.push(type);
    }
  }

  return {
    avg_sentence_length: avgSentenceLength,
    formality_estimate: Math.round(formalityEstimate * 100) / 100,
    emotional_estimate: Math.round(emotionalEstimate * 100) / 100,
    emoji_density: Math.round(emojiDensity * 100) / 100,
    hook_patterns: hookPatterns.length > 0 ? hookPatterns : ['question'],
  };
}

// ─── 스타일 요약 생성 ────────────────────────────────────────────────────────

/**
 * 수집된 시그널을 종합해 현재 Threads 트렌드 스타일 요약 생성.
 * agent-style-transfer 의 evaluation 시스템 역할.
 */
function generateStyleSummary(
  signals: TrendSignal[],
  dominantKeywords: string[],
): string {
  if (signals.length === 0) return '데이터 부족';

  const avgFormality = signals.reduce(
    (sum, s) => sum + (s.observed_style?.formality_estimate ?? 0.5), 0
  ) / signals.length;

  const avgEmotion = signals.reduce(
    (sum, s) => sum + (s.observed_style?.emotional_estimate ?? 0.5), 0
  ) / signals.length;

  const avgSentenceLen = Math.round(signals.reduce(
    (sum, s) => sum + (s.observed_style?.avg_sentence_length ?? 35), 0
  ) / signals.length);

  // 모든 후크 패턴 수집
  const allHooks = signals.flatMap(s => s.observed_style?.hook_patterns ?? []);
  const hookFrequency = new Map<string, number>();
  for (const h of allHooks) {
    hookFrequency.set(h, (hookFrequency.get(h) ?? 0) + 1);
  }
  const topHooks = [...hookFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);

  const parts = [
    `## 현재 Threads 트렌드 스타일 리포트 (${new Date().toLocaleDateString('ko-KR')})`,
    ``,
    `핫 키워드: ${dominantKeywords.join(', ')}`,
    ``,
    `### 관찰된 스타일`,
    `- 평균 문장 길이: ${avgSentenceLen}음절`,
    `- 격식 수준: ${avgFormality < 0.3 ? '캐주얼' : avgFormality < 0.5 ? '중립' : '격식'}`,
    `- 감정 표현: ${avgEmotion < 0.3 ? '낮음' : avgEmotion < 0.6 ? '중간' : '높음'}`,
    `- 인기 후크 패턴: ${topHooks.join(', ') || '질문형'}`,
    ``,
    `### 권장`,
    `- 현재 트렌드에 맞추려면 formality ${avgFormality < 0.4 ? '유지' : '낮춤'}, emotion ${avgEmotion > 0.5 ? '유지' : '약간 높임'}`,
    `- 후크는 ${topHooks[0] ?? 'question'} 스타일 추천`,
  ];

  return parts.join('\n');
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
